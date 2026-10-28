import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { env } from './env';
import { logger } from './logger';
import * as multiplayer from './services/multiplayerService';
import { SESSION_COOKIE_NAME, getSessionFromToken, type RequestSession } from './auth/session';
import type { Identity } from './auth/identity';

const MESSAGE_WINDOW_MS = 10_000;
const MESSAGE_LIMIT = 60;

interface AuthedSocket extends WebSocket {
  session: RequestSession;
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key || !value) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      // A malformed escape (`%zz`) used to throw out of the upgrade handler as an unhandled
      // rejection, which takes the whole process down.
    }
  }
  return out;
}

async function resolveSession(req: IncomingMessage): Promise<RequestSession | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  return token ? getSessionFromToken(token) : null;
}

/**
 * Rejects cross-site WebSocket hijacking: browsers don't enforce same-origin on `ws://`
 * upgrades the way they do on fetch, so without checking Origin a malicious page could open
 * a socket in a victim's browser and have it ride their (SameSite=Lax) session cookie.
 * Same-origin requests and configured dev origins pass; non-browser clients send no Origin.
 */
function isOriginAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (host) {
    try {
      if (new URL(origin).host === host) return true;
    } catch {
      /* malformed origin — fall through to the allowlist check */
    }
  }
  return env.CORS_ORIGIN.includes(origin);
}

/** Attaches the real-time multiplayer socket server to the app's HTTP server. */
export function attachWebSocketServer(server: Server): void {
  // The default maxPayload is 100 MiB; the largest real message is a join with a nickname.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  // Reap half-open sockets: a phone that sleeps or drops off wifi never sends a close frame, so
  // its seat would stay in the room, and its socket in memory, for good.
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  server.on('upgrade', (req, socket, head) => {
    if (!isOriginAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    void resolveSession(req)
      .then((session) => {
        if (!session) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req, session);
        });
      })
      .catch((err) => {
        logger.warn({ err }, 'WebSocket upgrade failed');
        socket.destroy();
      });
  });

  wss.on('connection', (ws: AuthedSocket, _req: IncomingMessage, session: RequestSession) => {
    ws.session = session;
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    const playerId = randomUUID();
    const identity: Identity = {
      userId: session.userId,
      guestId: session.userId ? null : session.guestId,
    };

    multiplayer.registerConnection({
      playerId,
      identity,
      socket: {
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason),
      },
    });

    // Fixed window per socket. A real client sends a handful of messages a second at most;
    // this caps room-code guessing and guess spam without touching normal play.
    let windowStart = Date.now();
    let windowCount = 0;

    ws.on('message', (data) => {
      const now = Date.now();
      if (now - windowStart > MESSAGE_WINDOW_MS) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > MESSAGE_LIMIT) {
        ws.close(1008, 'Too many messages');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      multiplayer.handleClientMessage(playerId, parsed).catch((err) => {
        logger.error({ err }, 'Multiplayer message failed');
      });
    });

    ws.on('close', () => {
      multiplayer.unregisterConnection(playerId);
    });

    ws.on('error', (err) => {
      logger.warn({ err }, 'WebSocket error');
    });
  });

  logger.info('Multiplayer WebSocket server attached');
}
