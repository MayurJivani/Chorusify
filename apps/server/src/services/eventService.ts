/**
 * Hosted events and their playlists: the stored half. The live half is a room in
 * multiplayerService, which this hands the event to through EventHooks.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { canHostEvents } from '../auth/roles';
import { db } from '../db/client';
import { events, playlists, type EventResultRow, type PlaylistTrack } from '../db/schema';
import { env } from '../env';
import { logger } from '../logger';
import { TtlCache } from '../utils/ttlCache';
import { count } from './metrics';
import {
  closeEventRoom,
  generateRoomCode,
  setEventHooks,
  type MpEvent,
} from './multiplayerService';

/** Four options per round need at least four songs to draw from. */
export const MIN_EVENT_TRACKS = 4;
export const MAX_PLAYLIST_TRACKS = 200;

export class EventError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * shortcut: a keyed HMAC, not argon2 like account passwords. A thousand people join in the same
 * minute and argon2 at that rate would stall the server. This is a door code read out to a room,
 * useless without SESSION_SECRET if the table leaks, and guesses are capped per socket. Upgrade if
 * event passwords ever protect something a person reuses elsewhere.
 */
export function hashEventPassword(eventId: string, password: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(`${eventId}:${password}`).digest('hex');
}

function passwordMatches(eventId: string, password: string, stored: string): boolean {
  const a = Buffer.from(hashEventPassword(eventId, password));
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Playlists ----------------------------------------------------------------------------

export function listPlaylists(ownerUserId: string) {
  return db
    .select()
    .from(playlists)
    .where(eq(playlists.ownerUserId, ownerUserId))
    .orderBy(desc(playlists.updatedAt));
}

export async function createPlaylist(ownerUserId: string, name: string, tracks: PlaylistTrack[]) {
  const [row] = await db
    .insert(playlists)
    .values({ id: randomUUID(), ownerUserId, name, tracks })
    .returning();
  return row!;
}

export async function updatePlaylist(
  ownerUserId: string,
  id: string,
  name: string,
  tracks: PlaylistTrack[],
) {
  const [row] = await db
    .update(playlists)
    .set({ name, tracks, updatedAt: new Date() })
    .where(and(eq(playlists.id, id), eq(playlists.ownerUserId, ownerUserId)))
    .returning();
  if (!row) throw new EventError(404, 'Playlist not found');
  return row;
}

export async function deletePlaylist(ownerUserId: string, id: string): Promise<void> {
  const rows = await db
    .delete(playlists)
    .where(and(eq(playlists.id, id), eq(playlists.ownerUserId, ownerUserId)))
    .returning({ id: playlists.id });
  if (!rows.length) throw new EventError(404, 'Playlist not found');
}

// --- Events -------------------------------------------------------------------------------

export interface EventInput {
  name: string;
  description: string;
  visibility: 'public' | 'unlisted';
  password?: string | null;
  audioMode: 'everyone_plays' | 'host_only';
  hostPlays: boolean;
  rounds: number;
  playbackSeconds: number;
  guessSeconds: number;
  maxPoints: number;
  minPoints: number;
  firstBonus: number;
  playlistId: string;
}

type EventRow = typeof events.$inferSelect;

/** What the host's own screens see. The password hash stays on the server. */
function toHostView(row: EventRow) {
  const { passwordHash, tracks, ...rest } = row;
  return {
    ...rest,
    hasPassword: passwordHash != null,
    trackCount: tracks.length,
    tracks,
  };
}

async function ownedEvent(ownerUserId: string, id: string): Promise<EventRow> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.id, id), eq(events.ownerUserId, ownerUserId)))
    .limit(1);
  if (!rows[0]) throw new EventError(404, 'Event not found');
  return rows[0];
}

export async function listEvents(ownerUserId: string) {
  const rows = await db
    .select()
    .from(events)
    .where(eq(events.ownerUserId, ownerUserId))
    .orderBy(desc(events.createdAt))
    .limit(100);
  return rows.map(toHostView);
}

export async function getEvent(ownerUserId: string, id: string) {
  return toHostView(await ownedEvent(ownerUserId, id));
}

/** Copies the playlist into the event. Later edits to the playlist do not reach it. */
async function snapshotFor(ownerUserId: string, input: EventInput): Promise<PlaylistTrack[]> {
  const rows = await db
    .select({ tracks: playlists.tracks })
    .from(playlists)
    .where(and(eq(playlists.id, input.playlistId), eq(playlists.ownerUserId, ownerUserId)))
    .limit(1);
  const tracks = rows[0]?.tracks;
  if (!tracks) throw new EventError(404, 'Playlist not found');
  if (tracks.length < MIN_EVENT_TRACKS) {
    throw new EventError(400, `A playlist needs at least ${MIN_EVENT_TRACKS} songs for an event.`);
  }
  return tracks;
}

const roundsFor = (input: EventInput, tracks: PlaylistTrack[]) =>
  Math.min(input.rounds, tracks.length);

export async function createEvent(ownerUserId: string, input: EventInput) {
  const tracks = await snapshotFor(ownerUserId, input);
  const id = randomUUID();
  // The code space is 32^6: a collision is rare, and the unique index catches the one that happens.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const [row] = await db
        .insert(events)
        .values({
          id,
          code: generateRoomCode(),
          ownerUserId,
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          passwordHash: input.password ? hashEventPassword(id, input.password) : null,
          audioMode: input.audioMode,
          hostPlays: input.hostPlays,
          rounds: roundsFor(input, tracks),
          playbackSeconds: input.playbackSeconds,
          guessSeconds: input.guessSeconds,
          maxPoints: input.maxPoints,
          minPoints: input.minPoints,
          firstBonus: input.firstBonus,
          playlistId: input.playlistId,
          tracks,
        })
        .returning();
      return toHostView(row!);
    } catch (err) {
      if (attempt >= 2) {
        count('eventCreateFailures');
        throw err;
      }
      logger.warn({ err }, 'Event insert failed; retrying with a new code');
    }
  }
}

/** Only while it has not started. A live event's rules and songs do not move under its players. */
export async function updateEvent(ownerUserId: string, id: string, input: EventInput) {
  const existing = await ownedEvent(ownerUserId, id);
  if (existing.status !== 'open') throw new EventError(409, 'This event has already started.');
  const tracks = await snapshotFor(ownerUserId, input);
  const [row] = await db
    .update(events)
    .set({
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      ...(input.password === null
        ? { passwordHash: null }
        : input.password
          ? { passwordHash: hashEventPassword(id, input.password) }
          : {}),
      audioMode: input.audioMode,
      hostPlays: input.hostPlays,
      rounds: roundsFor(input, tracks),
      playbackSeconds: input.playbackSeconds,
      guessSeconds: input.guessSeconds,
      maxPoints: input.maxPoints,
      minPoints: input.minPoints,
      firstBonus: input.firstBonus,
      playlistId: input.playlistId,
      tracks,
    })
    .where(and(eq(events.id, id), eq(events.status, 'open')))
    .returning();
  if (!row) throw new EventError(409, 'This event has already started.');
  closeEventRoom(id, 'The host changed this event. Rejoin to get the new version.');
  return toHostView(row);
}

export async function deleteEvent(ownerUserId: string, id: string): Promise<void> {
  const existing = await ownedEvent(ownerUserId, id);
  if (existing.status === 'live') throw new EventError(409, 'End this event first.');
  closeEventRoom(id, 'This event was removed by its host.');
  await db.delete(events).where(eq(events.id, id));
}

export async function closeEventsOwnedBy(ownerUserId: string, reason: string): Promise<void> {
  const rows = await db
    .update(events)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(events.ownerUserId, ownerUserId), ne(events.status, 'ended')))
    .returning({ id: events.id });
  for (const { id } of rows) closeEventRoom(id, reason);
}

export async function listPublicEvents() {
  return db
    .select({
      code: events.code,
      name: events.name,
      description: events.description,
      status: events.status,
      needsPassword: events.passwordHash,
    })
    .from(events)
    .where(and(eq(events.visibility, 'public'), inArray(events.status, ['open', 'live'])))
    .orderBy(desc(events.createdAt))
    .limit(30)
    .then((rows) => rows.map((r) => ({ ...r, needsPassword: r.needsPassword != null })));
}

/** A QR code on a screen means everyone asks at once, so the answer is held for a few seconds. */
const joinInfoCache = new TtlCache<{
  name: string;
  description: string;
  status: string;
  needsPassword: boolean;
} | null>(1000);

export async function getJoinInfo(code: string) {
  const cached = joinInfoCache.get(code);
  if (cached !== undefined) return cached;
  const rows = await db
    .select({
      name: events.name,
      description: events.description,
      status: events.status,
      passwordHash: events.passwordHash,
    })
    .from(events)
    .where(eq(events.code, code))
    .limit(1);
  const row = rows[0];
  const info = row
    ? {
        name: row.name,
        description: row.description,
        status: row.status,
        needsPassword: row.passwordHash != null,
      }
    : null;
  joinInfoCache.set(code, info, 5000);
  return info;
}

// --- The room's view of all this ----------------------------------------------------------

setEventHooks({
  async load(code) {
    const rows = await db.select().from(events).where(eq(events.code, code)).limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.status === 'ended') return 'ended';
    const event: MpEvent = {
      id: row.id,
      ownerUserId: row.ownerUserId,
      name: row.name,
      description: row.description,
      passwordHash: row.passwordHash,
      audioMode: row.audioMode as MpEvent['audioMode'],
      hostPlays: row.hostPlays,
      playbackSeconds: row.playbackSeconds,
    };
    return {
      event,
      tracks: row.tracks,
      config: {
        rounds: row.rounds,
        guessSeconds: row.guessSeconds,
        maxPoints: row.maxPoints,
        minPoints: row.minPoints,
        firstBonus: row.firstBonus,
      },
    };
  },
  canHost: canHostEvents,
  checkPassword: (event, password) =>
    !!event.passwordHash && passwordMatches(event.id, password, event.passwordHash),
  onStarted(eventId) {
    db.update(events)
      .set({ status: 'live', startedAt: new Date() })
      .where(eq(events.id, eventId))
      .catch((err) => logger.error({ err, eventId }, 'Failed to mark event live'));
  },
  onFinished(eventId, playerCount, top: EventResultRow[]) {
    db.update(events)
      .set({ status: 'ended', endedAt: new Date(), playerCount, results: top })
      .where(eq(events.id, eventId))
      .catch((err) => logger.error({ err, eventId }, 'Failed to store event result'));
  },
});
