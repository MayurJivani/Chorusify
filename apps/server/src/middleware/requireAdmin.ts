import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { logger } from '../logger';

/**
 * Gate for the admin tools.
 *
 * The flag is read from the database on every request rather than trusted from the session or a
 * token, so revoking someone's admin rights takes effect immediately instead of whenever their
 * session happens to expire.
 *
 * Note that `PATCH /users/:userId` below this gate *can* grant the flag, so admin is not a
 * database-only privilege: one compromised admin session can promote further accounts. Promotions
 * are logged by the route, and an unexpected admin should be treated as a session compromise.
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
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!rows[0]?.isAdmin) {
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
