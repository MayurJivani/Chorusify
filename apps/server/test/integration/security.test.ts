import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { connect } from 'node:net';
import { eq } from 'drizzle-orm';
import { createApp, isProxyableImageUrl } from '../../src/app';
import { attachWebSocketServer } from '../../src/ws';
import { db } from '../../src/db/client';
import { users, sessions, passwordResetTokens } from '../../src/db/schema';
import { createResetToken, resetPassword } from '../../src/services/passwordResetService';
import { clientIp } from '../../src/middleware/rateLimiters';

const app = createApp();

beforeEach(async () => {
  await db.delete(passwordResetTokens);
  await db.delete(sessions);
  await db.delete(users);
});

async function register(email: string) {
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/csrf-token')).body.csrfToken as string;
  const res = await agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', csrf)
    .send({ email, password: 'correct horse battery staple', displayName: 'Sec' });
  return { agent, csrf: res.body.csrfToken as string, id: res.body.user.id as string };
}

describe('security fixes', () => {
  it('a reset token works once even when two requests race with it', async () => {
    await register('race@example.com');
    const token = (await createResetToken('race@example.com'))!;
    const results = await Promise.allSettled([
      resetPassword(token, 'first new password 41'),
      resetPassword(token, 'second new password 42'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('changing password applies the policy and signs out other sessions', async () => {
    const { agent, csrf, id } = await register('change@example.com');
    const other = request.agent(app);
    const otherCsrf = (await other.get('/api/csrf-token')).body.csrfToken as string;
    await other
      .post('/api/auth/login')
      .set('X-CSRF-Token', otherCsrf)
      .send({ email: 'change@example.com', password: 'correct horse battery staple' });

    const weak = await agent
      .patch('/api/profile/password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'correct horse battery staple', newPassword: '12345678' });
    expect(weak.status).toBe(400);

    const ok = await agent
      .patch('/api/profile/password')
      .set('X-CSRF-Token', csrf)
      .send({
        currentPassword: 'correct horse battery staple',
        newPassword: 'a much better phrase 77',
      });
    expect(ok.status).toBe(200);

    expect(await db.select().from(sessions).where(eq(sessions.userId, id))).toHaveLength(1);
    expect((await other.get('/api/auth/me')).body.user).toBeNull();
  });

  it('the image proxy only accepts Deezer hosts over https', () => {
    expect(isProxyableImageUrl('https://cdn-images.dzcdn.net/images/artist/x/250x250.jpg')).toBe(
      true,
    );
    expect(isProxyableImageUrl('https://api.deezer.com/artist/27/image')).toBe(true);
    expect(isProxyableImageUrl('https://dzcdn.net.evil.com/x.jpg')).toBe(false);
    expect(isProxyableImageUrl('http://cdn-images.dzcdn.net/x.jpg')).toBe(false);
    expect(isProxyableImageUrl('https://169.254.169.254/latest')).toBe(false);
  });

  it('rate limits key on the Cloudflare client address, not the proxy', () => {
    const req = { ip: '127.0.0.1', headers: { 'cf-connecting-ip': '203.0.113.9' } };
    expect(clientIp(req as never)).toBe('203.0.113.9');
    expect(clientIp({ ip: '127.0.0.1', headers: {} } as never)).toBe('127.0.0.1');
  });

  it('a malformed cookie on a WebSocket upgrade does not crash the server', async () => {
    const server = createServer(app);
    attachWebSocketServer(server);
    server.listen(0);
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const sock = connect(port, '127.0.0.1');
    sock.write(
      'GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
        'Cookie: chorusify_sid=%zz\r\n\r\n',
    );
    const reply = await new Promise<string>((resolve) =>
      sock.once('data', (d) => resolve(String(d))),
    );
    expect(reply).toMatch(/401/);
    sock.destroy();
    server.close();
  });
});
