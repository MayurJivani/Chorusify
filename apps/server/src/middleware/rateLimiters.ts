import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../env';

/**
 * The visitor's address. On Jinx every request arrives cloudflared -> Caddy -> here, and Caddy
 * replaces X-Forwarded-For with its own peer (127.0.0.1), so `req.ip` is the same for everyone
 * and a limit keyed on it is one bucket for the whole site: ten wrong passwords from anyone
 * locked out every login. Cloudflare names the real client in CF-Connecting-IP.
 *
 * shortcut: the header is trusted because only Cloudflare reaches Caddy in production; a client
 * that can reach Caddy directly could rotate it. Upgrade by having Caddy set it (trusted_proxies).
 */
export function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  return ipKeyGenerator(typeof cf === 'string' && cf ? cf : (req.ip ?? ''));
}

// express-rate-limit instances are module-level singletons shared by every `createApp()`
// call within a process, which includes the whole integration test suite — a real limit here
// would make unrelated tests fail once enough requests accumulate across test files. Rate
// limiting itself isn't what those tests are exercising, so use an effectively-unlimited cap
// under test and keep the real production limits otherwise.
const isTest = env.NODE_ENV === 'test';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 100_000 : 10,
  standardHeaders: true,
  keyGenerator: clientIp,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

export const guessRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? 100_000 : 20,
  standardHeaders: true,
  keyGenerator: clientIp,
  legacyHeaders: false,
  message: { error: 'Too many guesses. Please slow down.' },
});

export const searchRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isTest ? 100_000 : 30,
  standardHeaders: true,
  keyGenerator: clientIp,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please slow down.' },
});

// Friend requests can name an account by email, and "no user with that email" answers whether
// that address is registered. Sign-up is free, so without a cap that is an enumeration oracle.
export const friendRequestRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: isTest ? 100_000 : 30,
  standardHeaders: true,
  keyGenerator: clientIp,
  legacyHeaders: false,
  message: { error: 'Too many friend requests. Please try again later.' },
});
