import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { env } from '../env';

export type Role = 'user' | 'event_host' | 'admin';

/** Lower-cased on both sides: accounts older than the registration schema may hold mixed case. */
export function isAdminEmail(email: string | null | undefined): boolean {
  return !!env.ADMIN_EMAIL && !!email && email.toLowerCase() === env.ADMIN_EMAIL;
}

/** What an account may do. Admin comes only from ADMIN_EMAIL, never from the stored role. */
export function effectiveRole(user: { email: string; role?: string }): Role {
  if (isAdminEmail(user.email)) return 'admin';
  return user.role === 'event_host' ? 'event_host' : 'user';
}

export async function canHostEvents(userId: string): Promise<boolean> {
  const rows = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  return !!user && effectiveRole(user) !== 'user';
}
