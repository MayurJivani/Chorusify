import { Router } from 'express';
import { z } from 'zod';
import { createRoom, isClassicEnabled, MP_MAX_ROUNDS } from '../services/multiplayerService';
import { resolveArtistSource, resolveCategorySource } from '../services/challengeSource';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';

export const multiplayerRouter = Router();

const createRoomSchema = z
  .object({
    artistId: z.coerce.number().int().positive().optional(),
    // A categoryId is either one slug or several joined with `+` (see CATEGORY_ID_SEPARATOR
    // in challengeSource.ts), so this needs room for a handful of combined categories.
    categoryId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9+-]+$/)
      .optional(),
    guessMode: z.enum(['search', 'choice']).optional().default('search'),
    gameMode: z.enum(['classic', 'speed']).optional().default('classic'),
    hostOnlyAudio: z.boolean().optional().default(false),
    hostPlayable: z.boolean().optional().default(true),
    rounds: z.coerce.number().int().min(1).max(MP_MAX_ROUNDS).optional(),
  })
  // Exactly one, so a request naming both can't quietly race over whichever the code checks
  // first while the player who sent it expects the other.
  .refine(
    (body) => (body.artistId != null) !== (body.categoryId != null),
    'Provide exactly one of artistId or categoryId',
  );

/**
 * Creates an empty room over an artist or a category. The creator then connects over the
 * WebSocket (/ws) and becomes host on their first `join_room`. Kept as a tiny REST call so
 * the browser can get the room code (for the shareable link) before the socket connects.
 */
multiplayerRouter.post(
  '/rooms',
  validate(createRoomSchema),
  asyncHandler(async (req, res) => {
    const { artistId, categoryId, guessMode, gameMode, hostOnlyAudio, hostPlayable, rounds } =
      req.body as z.infer<typeof createRoomSchema>;

    let source;
    try {
      source =
        artistId != null
          ? await resolveArtistSource(artistId, false)
          : resolveCategorySource(categoryId!);
    } catch {
      throw new HttpError(404, artistId != null ? 'Artist not found' : 'Unknown category');
    }

    // Mirrors what createRoom does with a disabled mode, so the response describes the room
    // that actually exists rather than the one that was asked for.
    const effectiveGameMode =
      gameMode === 'classic' && !isClassicEnabled() ? ('speed' as const) : gameMode;

    const { code } = await createRoom(
      source,
      guessMode,
      gameMode,
      hostOnlyAudio,
      hostPlayable,
      rounds,
    );
    res.status(201).json({
      code,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      label: source.label,
      pictureUrl: source.pictureUrl,
      guessMode: effectiveGameMode === 'speed' ? 'choice' : guessMode,
      gameMode: effectiveGameMode,
      hostOnlyAudio,
      hostPlayable,
    });
  }),
);
