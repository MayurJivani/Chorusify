import path from 'path';
import fs from 'fs';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { applySecurityMiddleware } from './middleware/security';
import { sessionMiddleware } from './auth/session';
import { doubleCsrfProtection, generateCsrfToken } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { logger } from './logger';
import { searchRateLimiter } from './middleware/rateLimiters';
import { getPublicGameConfig } from './services/settingsService';
import { renderIndexWithPreview } from './middleware/ogTags';
import { authRouter } from './routes/auth.routes';
import { songsRouter } from './routes/songs.routes';
import { puzzleRouter } from './routes/puzzle.routes';
import { statsRouter } from './routes/stats.routes';
import { artistsRouter } from './routes/artists.routes';
import { multiplayerRouter } from './routes/multiplayer.routes';
import { leaderboardRouter } from './routes/leaderboard.routes';
import { categoriesRouter } from './routes/categories.routes';
import { soundtracksRouter } from './routes/soundtracks.routes';
import { survivalRouter } from './routes/survival.routes';
import { eraRouter } from './routes/era.routes';
import { challengesRouter } from './routes/challenges.routes';
import { duelsRouter } from './routes/duels.routes';
import { adminRouter } from './routes/admin.routes';
import { friendsRouter } from './routes/friends.routes';
import { profileRouter } from './routes/profile.routes';
import { fandomRouter } from './routes/fandom.routes';

/** Deezer's own image hosts only, matched exactly so `dzcdn.net.evil.com` and the like fail. */
export function isProxyableImageUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return (
    parsed.protocol === 'https:' &&
    (parsed.hostname === 'api.deezer.com' || parsed.hostname.endsWith('.dzcdn.net'))
  );
}

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', 1);
  applySecurityMiddleware(app);
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Player-facing game config (snippet schedule, guess count, run length). Public because the
  // client needs it before anyone has logged in, and it contains nothing sensitive — the same
  // numbers are already visible in any challenge response.
  app.get('/api/config', (_req, res, next) => {
    getPublicGameConfig()
      .then((config) => res.json(config))
      .catch(next);
  });

  app.get('/api/csrf-token', (req, res) => {
    res.json({ csrfToken: generateCsrfToken(req, res) });
  });

  // Image proxy for card downloads — Deezer CDN doesn't send CORS headers,
  // so the Canvas API can't fetch artist images directly from the browser.
  app.get('/api/image-proxy', searchRateLimiter, async (req, res, next) => {
    try {
      const url = req.query.url;
      if (typeof url !== 'string' || !isProxyableImageUrl(url)) {
        res.status(403).json({ error: 'Domain not allowed' });
        return;
      }
      // Redirects are followed by hand, one hop, re-checking the host: api.deezer.com image
      // links redirect to the CDN, and an automatic follow would go wherever a redirect said.
      let upstream = await fetch(url, { redirect: 'manual' });
      const location = upstream.headers.get('location');
      if (upstream.status >= 300 && upstream.status < 400 && location) {
        const next = new URL(location, url).toString();
        if (!isProxyableImageUrl(next)) {
          res.status(403).json({ error: 'Domain not allowed' });
          return;
        }
        upstream = await fetch(next, { redirect: 'error' });
      }
      const ct = upstream.headers.get('content-type') ?? '';
      if (!upstream.ok || !ct.startsWith('image/')) {
        res.status(502).end();
        return;
      }
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    } catch (err) {
      next(err);
    }
  });

  app.use(doubleCsrfProtection);

  app.use('/api/auth', authRouter);
  app.use('/api/songs', songsRouter);
  app.use('/api/puzzle', puzzleRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/artists', artistsRouter);
  app.use('/api/multiplayer', multiplayerRouter);
  app.use('/api/leaderboard', leaderboardRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/soundtracks', soundtracksRouter);
  app.use('/api/survival', survivalRouter);
  app.use('/api/era', eraRouter);
  app.use('/api/challenges', challengesRouter);
  app.use('/api/duels', duelsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/friends', friendsRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/fandoms', fandomRouter);

  // Serve the built Vite frontend in production.
  // `public/` lives alongside `dist/` (i.e. at <server-root>/public).
  // In development this directory won't exist and Express will fall through.
  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) {
    // `index: false` matters: with the default, this would answer "/" with index.html directly
    // and the catch-all below would never run for the homepage — leaving the most-shared URL of
    // all with a relative og:image, which every crawler ignores.
    app.use(express.static(publicDir, { index: false }));
    // SPA catch-all: serve index.html for any non-/api route so that
    // client-side routes (e.g. /play, /artist) work on hard refresh.
    //
    // The HTML is rewritten rather than sent verbatim so that a shared link previews as what it
    // actually is. Crawlers don't run JavaScript, so tags React sets at runtime are invisible to
    // them, and every link — a Queen challenge, a survival streak — previewed identically.
    app.get('/{*path}', (req, res, next) => {
      const indexPath = path.join(publicDir, 'index.html');
      if (!fs.existsSync(indexPath)) {
        next();
        return;
      }

      renderIndexWithPreview(indexPath, req)
        .then((html) => res.type('html').send(html))
        .catch((err) => {
          // A preview is cosmetic — fall back to the unmodified page rather than 500 a route
          // that would otherwise have worked.
          logger.warn({ err, path: req.path }, 'Falling back to the unmodified index.html');
          res.sendFile(indexPath);
        });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
