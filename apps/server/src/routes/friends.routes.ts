import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { validate } from '../middleware/validate';
import { friendRequestRateLimiter } from '../middleware/rateLimiters';
import {
  FriendsError,
  getConversation,
  listFriends,
  listPendingRequests,
  removeFriend,
  respondToRequest,
  searchUsersByName,
  sendFriendRequest,
  sendFriendRequestToUser,
  sendMessage,
} from '../services/friendsService';

export const friendsRouter = Router();

function requireUser(req: { session: { userId: string | null } }): string {
  if (!req.session.userId) throw new FriendsError('Login required', 401);
  return req.session.userId;
}

friendsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    res.json(await listFriends(userId));
  }),
);

friendsRouter.get(
  '/pending',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    res.json(await listPendingRequests(userId));
  }),
);

/** Find people by display name. Two characters minimum — one matches most of the table. */
const searchSchema = z.object({ q: z.string().trim().min(2).max(40) });

friendsRouter.get(
  '/search',
  validate(searchSchema, 'query'),
  asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    const { q } = req.query as unknown as z.infer<typeof searchSchema>;
    res.json({ users: await searchUsersByName(q, userId) });
  }),
);

/**
 * Accepts either a picked user id (the username flow) or an email (the original one).
 *
 * Exactly one, so a request naming both cannot quietly act on whichever the code reads first
 * while the sender expects the other.
 */
const requestSchema = z
  .object({
    userId: z.string().min(1).max(64).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
  })
  .refine(
    (body) => (body.userId != null) !== (body.email != null),
    'Provide exactly one of userId or email',
  );

friendsRouter.post(
  '/request',
  friendRequestRateLimiter,
  validate(requestSchema),
  asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    const { userId: targetId, email } = req.body as z.infer<typeof requestSchema>;
    const result = targetId
      ? await sendFriendRequestToUser(userId, targetId)
      : await sendFriendRequest(userId, email!);
    res.status(201).json(result);
  }),
);

const respondSchema = z.object({ accept: z.boolean() });

friendsRouter.post(
  '/:id/respond',
  validate(respondSchema),
  asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    const friendshipId = Number(req.params.id);
    const { accept } = req.body as z.infer<typeof respondSchema>;
    await respondToRequest(friendshipId, userId, accept);
    res.json({ ok: true });
  }),
);

friendsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    await removeFriend(Number(req.params.id), userId);
    res.json({ ok: true });
  }),
);

// --- Chat ---

friendsRouter.get(
  '/:friendId/messages',
  asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    res.json(await getConversation(userId, req.params.friendId as string));
  }),
);

const messageSchema = z.object({
  body: z.string().max(500).default(''),
  invite: z
    .object({
      type: z.enum(['duel', 'multiplayer']),
      id: z.union([z.number(), z.string()]),
    })
    .optional(),
});

friendsRouter.post(
  '/:friendId/messages',
  validate(messageSchema),
  asyncHandler(async (req, res) => {
    const userId = requireUser(req);
    const { body, invite } = req.body as z.infer<typeof messageSchema>;
    const msg = await sendMessage(userId, req.params.friendId as string, body, invite);
    res.status(201).json(msg);
  }),
);
