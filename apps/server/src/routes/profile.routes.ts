import { Router } from 'express';
import { z } from 'zod';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { hashPassword, verifyPassword } from '../auth/password';
import { requireAuth } from '../middleware/requireAuth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { authRateLimiter } from '../middleware/rateLimiters';
import {
  passwordProblems,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../utils/passwordPolicy';

export const profileRouter = Router();

profileRouter.use(requireAuth);

const updateDisplayNameSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
});

profileRouter.patch(
  '/display-name',
  validate(updateDisplayNameSchema),
  asyncHandler(async (req, res) => {
    const { displayName } = req.body as z.infer<typeof updateDisplayNameSchema>;
    await db.update(users).set({ displayName }).where(eq(users.id, req.session.userId!));
    res.json({ ok: true, displayName });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

profileRouter.patch(
  '/password',
  authRateLimiter,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    const userId = req.session.userId!;

    const [user] = await db
      .select({
        passwordHash: users.passwordHash,
        email: users.email,
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) throw new HttpError(404, 'User not found');

    const valid = await verifyPassword(user.passwordHash, currentPassword);
    if (!valid) throw new HttpError(401, 'Current password is incorrect');

    // Same rule as register and reset; this route used to accept any eight characters.
    const problems = passwordProblems(newPassword, user);
    if (problems.length > 0) {
      res.status(400).json({ error: problems[0], problems });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    // Sign out every other device: a password change is how someone ends a session they think
    // was stolen, so leaving those sessions alive defeats the point.
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, req.session.id)));
    res.json({ ok: true });
  }),
);

profileRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        rating: users.rating,
        ratedDuels: users.ratedDuels,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.session.userId!))
      .limit(1);

    if (!user) throw new HttpError(404, 'User not found');
    res.json(user);
  }),
);
