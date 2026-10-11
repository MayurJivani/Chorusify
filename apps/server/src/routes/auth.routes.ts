import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { hashPassword, verifyPassword } from '../auth/password';
import { bindUserToSession, destroySession } from '../auth/session';
import { mergeGuestStatsIntoUser } from '../services/statsService';
import { validate } from '../middleware/validate';
import { authRateLimiter } from '../middleware/rateLimiters';
import { generateCsrfToken } from '../middleware/csrf';
import { asyncHandler } from '../middleware/asyncHandler';
import { createResetToken, resetPassword, ResetError } from '../services/passwordResetService';
import { env } from '../env';
import {
  passwordProblems,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../utils/passwordPolicy';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  displayName: z.string().trim().min(1).max(40),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
});

function toPublicUser(user: { id: string; email: string; displayName: string; isAdmin?: boolean }) {
  // `isAdmin` only controls whether the client bothers to show the admin link — every admin
  // route re-checks the flag against the database itself, so a tampered client gains nothing.
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin ?? false,
  };
}

authRouter.post('/register', authRateLimiter, validate(registerSchema), async (req, res) => {
  const { email, password, displayName } = req.body as z.infer<typeof registerSchema>;

  // Checked here as well as in the client form: the form is a courtesy, this is the rule.
  const problems = passwordProblems(password, { email, displayName });
  if (problems.length > 0) {
    res.status(400).json({ error: problems[0], problems });
    return;
  }

  const existingRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const existing = existingRows[0];
  if (existing) {
    res.status(409).json({ error: 'An account with that email already exists' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const id = randomUUID();
  const guestId = req.session.guestId;

  await db.insert(users).values({ id, email, passwordHash, displayName });
  await mergeGuestStatsIntoUser(guestId, id);
  await bindUserToSession(req, res, id);
  // Rotating the session invalidates the CSRF token the client is holding — issue a fresh one
  // bound to the new session so the very next state-changing request doesn't get rejected.
  const csrfToken = generateCsrfToken(req, res, { overwrite: true });

  res.status(201).json({ user: toPublicUser({ id, email, displayName }), csrfToken });
});

authRouter.post('/login', authRateLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = userRows[0];
  const genericError = { error: 'Invalid email or password' };

  if (!user) {
    // Still hash something to keep response timing similar whether or not the account exists.
    await hashPassword(password);
    res.status(401).json(genericError);
    return;
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    res.status(401).json(genericError);
    return;
  }

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await bindUserToSession(req, res, user.id);
  const csrfToken = generateCsrfToken(req, res, { overwrite: true });

  res.json({ user: toPublicUser(user), csrfToken });
});

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await destroySession(req, res);
    const csrfToken = generateCsrfToken(req, res, { overwrite: true });
    res.json({ ok: true, csrfToken });
  }),
);

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email() });

authRouter.post(
  '/forgot-password',
  authRateLimiter,
  validate(forgotSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as z.infer<typeof forgotSchema>;
    const token = await createResetToken(email);

    // Only ever echoed back when NODE_ENV is *explicitly* development. Checking `!== production`
    // here would fail open: NODE_ENV defaults to development, so any deploy that forgot to set it
    // would hand a working reset token for any email to whoever asked, admins included.
    if (env.NODE_ENV === 'development' && token) {
      res.json({ ok: true, resetToken: token });
      return;
    }

    // Always 200 to prevent email enumeration. In production this would send an email.
    // TODO: integrate an email provider (Resend, SES, etc.)
    res.json({ ok: true });
  }),
);

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

authRouter.post(
  '/reset-password',
  authRateLimiter,
  validate(resetSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body as z.infer<typeof resetSchema>;
    // No email or name to compare against here — the token identifies the account, and looking
    // it up just to reject a password would leak whether the token is valid before it is used.
    const problems = passwordProblems(password);
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0], problems });
      return;
    }
    try {
      await resetPassword(token, password);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof ResetError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.session.userId) {
      res.json({ user: null, guestId: req.session.guestId });
      return;
    }

    const userRows = await db.select().from(users).where(eq(users.id, req.session.userId)).limit(1);
    const user = userRows[0];
    if (!user) {
      res.json({ user: null, guestId: req.session.guestId });
      return;
    }

    res.json({ user: toPublicUser(user) });
  }),
);
