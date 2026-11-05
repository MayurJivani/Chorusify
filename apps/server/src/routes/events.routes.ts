import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { HttpError } from '../middleware/errorHandler';
import { clientIp } from '../middleware/rateLimiters';
import { requireEventHost } from '../middleware/requireAdmin';
import { validate } from '../middleware/validate';
import { env } from '../env';
import { searchSongs } from '../services/deezerService';
import * as eventService from '../services/eventService';
import { importSpotifyPlaylist, SpotifyImportError } from '../services/spotifyImport';
import { EventError, MAX_PLAYLIST_TRACKS } from '../services/eventService';

export const eventsRouter = Router();

const mapEventErrors = (err: unknown): never => {
  if (err instanceof EventError) throw new HttpError(err.status, err.message);
  throw err;
};

// --- Public: joining ----------------------------------------------------------------------

eventsRouter.get(
  '/public',
  asyncHandler(async (_req, res) => {
    res.json({ events: await eventService.listPublicEvents() });
  }),
);

eventsRouter.get(
  '/join/:code',
  validate(
    z.object({
      code: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{4,12}$/),
    }),
    'params',
  ),
  asyncHandler(async (req, res) => {
    const info = await eventService.getJoinInfo((req.params.code as string).toUpperCase());
    // Not an error: most room codes are ordinary rooms, which the socket handles.
    res.json({ event: info });
  }),
);

// --- Hosts only ---------------------------------------------------------------------------

const host = Router();
host.use(requireEventHost);
eventsRouter.use(host);

/** Keyed on the account: a campus shares one address, and each host's typing is their own. */
const hostSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 100_000 : 90,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session.userId ?? clientIp(req),
  message: { error: 'Too many searches. Please slow down.' },
});

const searchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  field: z.enum(['any', 'artist', 'album']).optional().default('any'),
});

host.get(
  '/songs/search',
  hostSearchLimiter,
  validate(searchSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { q, field } = req.query as unknown as z.infer<typeof searchSchema>;
    res.json({ results: await searchSongs(q, field) });
  }),
);

/** An import is up to a couple of hundred Deezer lookups, so it gets a much smaller allowance. */
const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 100_000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.session.userId ?? clientIp(req),
  message: { error: 'Too many imports. Wait a minute and try again.' },
});

host.post(
  '/import/spotify',
  importLimiter,
  validate(z.object({ url: z.string().trim().min(10).max(300) })),
  asyncHandler(async (req, res) => {
    try {
      res.json(await importSpotifyPlaylist((req.body as { url: string }).url, MAX_PLAYLIST_TRACKS));
    } catch (err) {
      if (err instanceof SpotifyImportError) throw new HttpError(400, err.message);
      throw err;
    }
  }),
);

const deezerArtUrl = z
  .string()
  .url()
  .max(500)
  .refine(
    (url) =>
      new URL(url).hostname.endsWith('.dzcdn.net') || new URL(url).hostname === 'api.deezer.com',
  )
  .nullable();

const decoySchema = z.object({
  deezerTrackId: z.string().regex(/^\d{1,20}$/),
  title: z.string().min(1).max(300),
  artist: z.string().min(1).max(300),
  albumArtUrl: deezerArtUrl,
});

const trackSchema = z
  .object({
    deezerTrackId: z.string().regex(/^\d{1,20}$/),
    title: z.string().min(1).max(300),
    artist: z.string().min(1).max(300),
    album: z.string().max(300).nullable(),
    albumArtUrl: deezerArtUrl,
    durationSeconds: z.number().int().min(0).max(36000),
    // Three wrong answers fill a four-option round.
    decoys: z.array(decoySchema).max(3).optional(),
  })
  .refine(
    (t) => !t.decoys?.some((d) => d.deezerTrackId === t.deezerTrackId),
    'A song cannot be its own wrong answer',
  );

const playlistSchema = z.object({
  name: z.string().trim().min(1).max(80),
  tracks: z
    .array(trackSchema)
    .max(MAX_PLAYLIST_TRACKS)
    .refine(
      (tracks) => new Set(tracks.map((t) => t.deezerTrackId)).size === tracks.length,
      'A song can only be in a playlist once',
    ),
});

const idParams = z.object({ id: z.string().uuid() });
const ownerId = (req: { session: { userId: string | null } }) => req.session.userId!;

host.get(
  '/playlists',
  asyncHandler(async (req, res) => {
    res.json({ playlists: await eventService.listPlaylists(ownerId(req)) });
  }),
);

host.post(
  '/playlists',
  validate(playlistSchema),
  asyncHandler(async (req, res) => {
    const { name, tracks } = req.body as z.infer<typeof playlistSchema>;
    res
      .status(201)
      .json({ playlist: await eventService.createPlaylist(ownerId(req), name, tracks) });
  }),
);

host.patch(
  '/playlists/:id',
  validate(idParams, 'params'),
  validate(playlistSchema),
  asyncHandler(async (req, res) => {
    const { name, tracks } = req.body as z.infer<typeof playlistSchema>;
    const playlist = await eventService
      .updatePlaylist(ownerId(req), req.params.id as string, name, tracks)
      .catch(mapEventErrors);
    res.json({ playlist });
  }),
);

host.delete(
  '/playlists/:id',
  validate(idParams, 'params'),
  asyncHandler(async (req, res) => {
    await eventService.deletePlaylist(ownerId(req), req.params.id as string).catch(mapEventErrors);
    res.json({ ok: true });
  }),
);

const eventSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).default(''),
    visibility: z.enum(['public', 'unlisted']).default('unlisted'),
    // Omitted keeps the current one on an edit, null removes it.
    password: z.string().min(1).max(100).nullable().optional(),
    audioMode: z.enum(['everyone_plays', 'host_only']),
    hostPlays: z.boolean().default(false),
    rounds: z.number().int().min(1).max(MAX_PLAYLIST_TRACKS),
    playbackSeconds: z.number().int().min(3).max(30),
    guessSeconds: z.number().int().min(5).max(120),
    maxPoints: z.number().int().min(1).max(10000),
    minPoints: z.number().int().min(0).max(10000),
    firstBonus: z.number().int().min(0).max(10000),
    playlistId: z.string().uuid(),
    trialTrack: trackSchema.nullable().default(null),
    showCovers: z.boolean().default(false),
  })
  .refine((e) => e.minPoints <= e.maxPoints, 'Minimum points cannot be above maximum points');

host.get(
  '/mine',
  asyncHandler(async (req, res) => {
    res.json({ events: await eventService.listEvents(ownerId(req)) });
  }),
);

host.post(
  '/',
  validate(eventSchema),
  asyncHandler(async (req, res) => {
    const event = await eventService
      .createEvent(ownerId(req), req.body as eventService.EventInput)
      .catch(mapEventErrors);
    res.status(201).json({ event });
  }),
);

host.get(
  '/:id',
  validate(idParams, 'params'),
  asyncHandler(async (req, res) => {
    const event = await eventService
      .getEvent(ownerId(req), req.params.id as string)
      .catch(mapEventErrors);
    res.json({ event });
  }),
);

host.patch(
  '/:id',
  validate(idParams, 'params'),
  validate(eventSchema),
  asyncHandler(async (req, res) => {
    const event = await eventService
      .updateEvent(ownerId(req), req.params.id as string, req.body as eventService.EventInput)
      .catch(mapEventErrors);
    res.json({ event });
  }),
);

host.delete(
  '/:id',
  validate(idParams, 'params'),
  asyncHandler(async (req, res) => {
    await eventService.deleteEvent(ownerId(req), req.params.id as string).catch(mapEventErrors);
    res.json({ ok: true });
  }),
);
