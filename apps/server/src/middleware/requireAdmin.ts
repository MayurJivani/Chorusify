import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { logger } from '../logger';
import { canHostEvents, isAdminEmail } from '../auth/roles';

/**
 * Gate for the admin tools.
 *
 * The account's email is read from the database on every request and compared to ADMIN_EMAIL, so
 * admin cannot be granted by any row, request body or session. There is one admin, and changing it
 * takes a config change.
 *
 * A non-admin gets 404, not 403: confirming that an endpoint exists but is forbidden tells an
 * attacker there is something worth attacking.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    const rows = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!isAdminEmail(rows[0]?.email)) {
      logger.warn({ userId, path: req.path }, 'Rejected non-admin request to admin route');
      res.status(404).json({ error: 'Not found' });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  next();
}

/** Event hosts and the admin. Checked against the database so a revocation applies at once. */
export async function requireEventHost(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    if (!(await canHostEvents(userId))) {
      res.status(403).json({ error: 'Event host access required' });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }
  next();
}
