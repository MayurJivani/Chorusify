import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import type { Identity } from '../auth/identity';
import { getFreshPreviewUrl, type ArtistTrack } from './deezerService';
import { buildRoundOptions, type RoundOption } from './artistChallengeService';
import {
  resolveArtistSource,
  resolveCategorySource,
  type ChallengeSource,
  type ChallengeSourceType,
} from './challengeSource';
import { recordLiveDuel, type DuelMode } from './duelService';
import * as duelQueue from './duelQueueService';
import { seededShuffle } from '../utils/deterministic';
import { timeDecayScore } from '../utils/scoring';
import { getSettings } from './settingsService';
import { logger } from '../logger';
import { isOffensiveName } from '../utils/nameFilter';
import { answerProcessingMs, count, registerMetricSources } from './metrics';

/** Seconds of audio revealed at each reveal stage, Heardle-style. Players advance their own
 *  snippet one stage at a time with a "reveal more" action instead of a shared auto-timer. */
export const MP_REVEAL_SCHEDULE = [1, 2, 4, 7, 11, 16] as const;
/** Points for guessing at each reveal stage — fewer reveals means more points. */
export const MP_REVEAL_POINTS = [6, 5, 4, 3, 2, 1] as const;
/**
 * Defaults for the tunables below. Each room copies the live settings into itself when it is
 * created, so a change made mid-game never rewrites the rules a room is already playing by —
 * shortening a game from 10 rounds to 5 must not strand a room on round 8.
 */
export const MP_ROUND_DURATION_MS = 30 * 1000;
export const MP_ROUNDS = 10;
export const MP_REVEAL_DURATION_MS = 10_000;
/** Fallback only; the live limit is the `multiplayerMaxPlayers` setting, which goes far higher. */
export const MP_MAX_PLAYERS = 8;
export const MP_EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
/** The size load-tested end to end. See docs/LOAD-TEST.md before raising it. */
export const EVENT_MAX_PLAYERS = 1000;
/**
 * Above this a room stops broadcasting per action. A join or guess then marks the room dirty and
 * one frame goes out per interval, because a frame per action in a full room is N frames to N
 * sockets. Smaller rooms keep the instant update, where it is cheap and people notice.
 */
const COALESCE_ABOVE_PLAYERS = 32;
const COALESCE_INTERVAL_MS = 250;
/** Names carried by a large room's snapshot: the newest joiners, for the lobby to show. */
const LARGE_ROOM_SNAPSHOT_PLAYERS = 24;
/** Time for every phone to buffer and for clients to line up on one start instant. */
const EVENT_ROUND_LEAD_MS = 2500;
/** A phone asleep in the lobby keeps its seat this long, then stops counting as present. */
const LOBBY_SEAT_GRACE_MS = 2 * 60 * 1000;
const EVENT_IDLE_ROOM_TTL_MS = 30 * 60 * 1000;
const MAX_PASSWORD_ATTEMPTS = 5;

/**
 * Multiplayer choice rounds offer four answers, not the three a single-player run uses.
 * Everyone hears the same snippet at the same time, so a one-in-three guess lands often
 * enough to flatten the scoreboard; a fourth option restores some separation without making
 * the buttons too small to hit on a phone.
 */
export const MP_CHOICE_OPTIONS = 4;

/**
 * Ceiling on a host-chosen game length. The admin setting supplies the default; this only
 * bounds what a room may ask for, so a request for 500 rounds can't tie up a room (and the
 * Deezer preview lookups behind it) for an afternoon.
 */
export const MP_MAX_ROUNDS = 25;

/** Below this there is no game to play, however thin the catalogue. */
export const MP_MIN_ROUNDS = 3;

/**
 * Classic (progressive reveal, points by stage) is switched off for now — every room plays a
 * Speed Round. The mode is disabled rather than deleted: all of its branches below are still
 * live and correct, so flipping this back on restores it with no other change.
 *
 * Kept behind a function rather than a bare const so the test suite can re-enable it and keep
 * exercising those branches. Code that is disabled *and* untested is code that has quietly
 * rotted by the time anyone wants it back.
 */
let classicEnabled = false;

export function isClassicEnabled(): boolean {
  return classicEnabled;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** An opaque outbound channel — the real WebSocket wrapper lives in ws.ts, a fake in tests. */
export interface MpSocket {
  send(data: string | Buffer): void;
  close(code?: number, reason?: string): void;
}

/**
 * `starting` covers the gap between the host pressing the button and the first round being
 * ready. That gap is not small: a category nobody has played yet builds its pool from Deezer,
 * and every candidate track then needs a fresh preview url. Without a phase for it the lobby
 * looked untouched, so the host pressed start again and paid for the whole build twice.
 */
export type MpRoomPhase = 'lobby' | 'starting' | 'playing' | 'round-reveal' | 'finished';

export interface MpPlayerState {
  playerId: string;
  displayName: string;
  isHost: boolean;
  score: number;
  roundAnswered: boolean;
  roundCorrect: boolean | null;
  roundPoints: number;
  /** This player's own reveal stage for the current round (0 = only the first slice heard). */
  stageIndex: number;
  joinedAt: number;
  connected?: boolean;
}

interface MpPlayer extends MpPlayerState {
  /** Stable across reconnects, unlike playerId: it is what holds an event seat. */
  seatKey: string;
  disconnectedAt: number | null;
  /** Answer time in the current round, so a skipped round can be taken back out. */
  roundAnswerMs: number;
  socket: MpSocket;
  identity: Identity;
  /**
   * Score as it stood when the round began, reported in place of the live one until the reveal.
   *
   * Without it the total is a tell: a number going up the instant someone answers announces
   * that they were right, to them and to everyone watching the scoreboard. Suspense until the
   * reveal is the point of a shared round.
   */
  scoreAtRoundStart: number;
  /**
   * Total milliseconds spent answering across the game, summed per round.
   *
   * The tie breaker. Two players on the same score have not necessarily played the same game —
   * one may have been first to every answer and the other last — and leaving that as an
   * arbitrary order made a drawn duel feel like a coin toss.
   */
  totalAnswerMs: number;
}

/** How players answer: type-to-search over the artist's catalog, or pick one of three. */
export type MpGuessMode = 'search' | 'choice';

/** Classic: progressive reveal, points by stage. Speed: full snippet, first correct wins. */
export type MpGameMode = 'classic' | 'speed';

/**
 * What makes a room a rated duel rather than a friendly race.
 *
 * A duel is deliberately *not* a separate game engine — the rounds, scoring, sockets and reveal
 * are identical, so it is an ordinary room with two named seats, no host button, and a rating
 * applied at the end. Anything else would be a second copy of the game loop to keep in step.
 */
interface MpDuel {
  /** The two accounts the matchmaker paired. Nobody else may take a seat. */
  challengerUserId: string;
  opponentUserId: string;
  sourceType: string;
  sourceId: string;
  label: string;
  /** Which rating ladder this duel counts towards — the queue the pair came from. */
  mode: DuelMode;
  /** Guards against settling twice — a forfeit and a natural finish can race. */
  settled: boolean;
}

/** What makes a room a hosted event. See eventService for the stored half. */
export interface MpEvent {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  passwordHash: string | null;
  audioMode: 'everyone_plays' | 'host_only';
  hostPlays: boolean;
  playbackSeconds: number;
}

export interface EventHooks {
  /** Finds a stored event whose room is not in memory (first join, or after a restart). */
  load(
    code: string,
  ): Promise<{ event: MpEvent; tracks: ArtistTrack[]; config: EventRoomConfig } | 'ended' | null>;
  canHost(userId: string): Promise<boolean>;
  checkPassword(event: MpEvent, password: string): boolean;
  onStarted(eventId: string): void;
  onFinished(
    eventId: string,
    playerCount: number,
    top: { rank: number; displayName: string; score: number }[],
  ): void;
}

export interface EventRoomConfig {
  rounds: number;
  guessSeconds: number;
  maxPoints: number;
  minPoints: number;
  firstBonus: number;
}

let eventHooks: EventHooks | null = null;
export function setEventHooks(hooks: EventHooks): void {
  eventHooks = hooks;
}

interface MpRoom {
  code: string;
  /** Present on hosted events. The owner then controls the room without holding a player seat. */
  event?: MpEvent;
  /** Event seats by identity, so a reconnect finds its score and a second tab replaces the first. */
  seats: Map<string, MpPlayer>;
  kicked: Set<string>;
  /** When the current phase's timer fires, and what is left of it while paused. */
  phaseEndsAt: number;
  paused: { at: number; remainingMs: number } | null;
  /** Answer ranks frozen at round start; a thousand guesses would otherwise each sort the room. */
  roundRanks: Map<string, number>;
  scoresTimer: ReturnType<typeof setTimeout> | null;
  stateTimer: ReturnType<typeof setTimeout> | null;
  lastActiveAt: number;
  /**
   * What the room's songs come from.
   *
   * Was an artist id, which is why Multiplayer could only ever race over one artist. Holding a
   * `ChallengeSource` instead means a category room needs no new game logic — the rounds, the
   * scoring and the socket protocol are identical, only the pool differs.
   */
  source: ChallengeSource;
  guessMode: MpGuessMode;
  gameMode: MpGameMode;
  phase: MpRoomPhase;
  hostId: string;
  players: Map<string, MpPlayer>;
  tracks: ArtistTrack[];
  previewUrls: string[];
  /** Per-round multiple-choice options, empty in search mode. Built once when the game starts
   *  so every player is offered exactly the same answers. */
  roundOptions: RoundOption[][];
  currentRound: number;
  roundStartedAt: number;
  timers: ReturnType<typeof setTimeout>[];
  createdAt: number;
  /** Settings snapshotted at creation — see the constants above for why. */
  rounds: number;
  roundDurationMs: number;
  revealDurationMs: number;
  maxPlayers: number;
  revealSchedule: readonly number[];
  speedRoundDurationMs: number;
  speedSnippetSeconds: number;
  speedPoints: readonly number[];
  speedMaxPoints: number;
  speedMinPoints: number;
  /** Number of correct guesses so far this round in speed mode (for order-based scoring). */
  speedCorrectCount: number;
  hostOnlyAudio: boolean;
  hostPlayable: boolean;
  /** Present only on rated 1v1 rooms created by the duel matchmaker. */
  duel?: MpDuel;
}

export interface MpScoreEntry {
  playerId: string;
  displayName: string;
  score: number;
  /** Cumulative time spent answering. Lower wins a tie; shown so a draw is explicable. */
  totalAnswerMs: number;
  answered: boolean;
  correctThisRound: boolean | null;
  /** This player's reveal stage for the current round (0 = heard only the first slice). */
  stageIndex: number;
  /** Shared by players level on points and answer time. */
  rank: number;
}

export interface MpRoomSnapshot {
  code: string;
  sourceType: ChallengeSourceType;
  sourceId: string;
  /** The artist's name or the category's label, whichever the room races over. */
  label: string;
  pictureUrl: string | null;
  guessMode: MpGuessMode;
  gameMode: MpGameMode;
  phase: MpRoomPhase;
  hostId: string;
  currentRound: number;
  totalRounds: number;
  players: MpPlayerState[];
  hostOnlyAudio: boolean;
  hostPlayable: boolean;
  /** True on a rated duel, so the client can drop the host controls and show the stakes. */
  isDuel: boolean;
  /** Everyone in the room. `players` only holds the newest few once a room is large. */
  playerCount: number;
  event: {
    id: string;
    name: string;
    description: string;
    audioMode: MpEvent['audioMode'];
  } | null;
  paused: boolean;
}

const emptyRoomExtras = () => ({
  seats: new Map<string, MpPlayer>(),
  kicked: new Set<string>(),
  phaseEndsAt: 0,
  paused: null,
  roundRanks: new Map<string, number>(),
  scoresTimer: null,
  stateTimer: null,
  lastActiveAt: Date.now(),
});

const rooms = new Map<string, MpRoom>();
const sockets = new Map<string, MpSocket>();
const identities = new Map<string, Identity>();
const playerRooms = new Map<string, string>();

export function generateRoomCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const b of bytes) {
    code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  }
  return code;
}

export async function createRoom(
  source: ChallengeSource,
  guessMode: MpGuessMode = 'search',
  gameMode: MpGameMode = 'classic',
  hostOnlyAudio: boolean = false,
  hostPlayable: boolean = true,
  /** Host-chosen game length. Omitted falls back to the admin default. */
  rounds?: number,
): Promise<{ code: string }> {
  let code = '';
  do {
    code = generateRoomCode();
  } while (rooms.has(code));

  const settings = await getSettings();

  // Classic is off (see isClassicEnabled) — a room asking for it still gets a playable game.
  const effectiveGameMode: MpGameMode =
    gameMode === 'classic' && !isClassicEnabled() ? 'speed' : gameMode;

  rooms.set(code, {
    code,
    source,
    // Movie sources have no searchable answer — a player typing into song search would be
    // looking for the film by name in a track index. Choice is the only workable mode there.
    guessMode: effectiveGameMode === 'speed' || source.answerIsTitle ? 'choice' : guessMode,
    gameMode: effectiveGameMode,
    phase: 'lobby',
    hostId: '',
    players: new Map(),
    tracks: [],
    previewUrls: [],
    roundOptions: [],
    currentRound: 0,
    roundStartedAt: 0,
    timers: [],
    createdAt: Date.now(),
    rounds:
      rounds != null
        ? Math.max(1, Math.min(MP_MAX_ROUNDS, Math.floor(rounds)))
        : settings.multiplayerRounds,
    roundDurationMs: settings.multiplayerRoundSeconds * 1000,
    revealDurationMs: settings.multiplayerRevealSeconds * 1000,
    maxPlayers: settings.multiplayerMaxPlayers,
    revealSchedule: settings.snippetScheduleSeconds,
    speedRoundDurationMs: settings.speedRoundDurationSeconds * 1000,
    speedSnippetSeconds: settings.speedSnippetSeconds,
    speedPoints: settings.speedPoints,
    speedMaxPoints: settings.speedMaxPoints,
    speedMinPoints: settings.speedMinPoints,
    speedCorrectCount: 0,
    hostOnlyAudio,
    hostPlayable,
    ...emptyRoomExtras(),
  });

  logger.info(
    {
      code,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      guessMode,
      gameMode: effectiveGameMode,
    },
    'Multiplayer room created',
  );
  return { code };
}

/** How many songs a rated duel runs over. Fixed rather than chosen: both sides have to agree,
 *  and there is no host to make the call. */
export const DUEL_ROUNDS = 10;

/**
 * Creates the room a matched pair will race in.
 *
 * Built here rather than in the matchmaker so a duel gets the identical round loop as any other
 * room — the only differences are the two reserved seats, the fixed length, and the rating that
 * lands when it finishes.
 */
export async function createDuelRoom(
  source: ChallengeSource,
  challengerUserId: string,
  opponentUserId: string,
  mode: DuelMode,
): Promise<{ code: string }> {
  const { code } = await createRoom(source, 'choice', 'speed', false, true, DUEL_ROUNDS);
  const room = rooms.get(code);
  if (!room) throw new Error('Duel room vanished immediately after creation');

  room.maxPlayers = 2;
  room.duel = {
    challengerUserId,
    opponentUserId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    label: source.label,
    mode,
    settled: false,
  };

  logger.info({ code, challengerUserId, opponentUserId, label: source.label }, 'Duel room created');
  return { code };
}

/** Puts a stored event's room in memory. Its rules come from the event, not the admin settings. */
async function createEventRoom(
  code: string,
  event: MpEvent,
  tracks: ArtistTrack[],
  config: EventRoomConfig,
): Promise<MpRoom> {
  const settings = await getSettings();
  const existing = rooms.get(code);
  if (existing) return existing;
  const room: MpRoom = {
    code,
    event,
    source: {
      sourceType: 'category',
      sourceId: event.id,
      label: event.name,
      pictureUrl: null,
      answerIsTitle: false,
      loadCatalog: async () => tracks,
    } as unknown as ChallengeSource,
    guessMode: 'choice',
    gameMode: 'speed',
    phase: 'lobby',
    hostId: '',
    players: new Map(),
    tracks: [],
    previewUrls: [],
    roundOptions: [],
    currentRound: 0,
    roundStartedAt: 0,
    timers: [],
    createdAt: Date.now(),
    rounds: config.rounds,
    roundDurationMs: config.guessSeconds * 1000,
    revealDurationMs: settings.multiplayerRevealSeconds * 1000,
    maxPlayers: EVENT_MAX_PLAYERS,
    revealSchedule: settings.snippetScheduleSeconds,
    speedRoundDurationMs: config.guessSeconds * 1000,
    speedSnippetSeconds: event.playbackSeconds,
    speedPoints: [config.firstBonus],
    speedMaxPoints: config.maxPoints,
    speedMinPoints: config.minPoints,
    speedCorrectCount: 0,
    hostOnlyAudio: event.audioMode === 'host_only',
    hostPlayable: true,
    ...emptyRoomExtras(),
  };
  rooms.set(code, room);
  logger.info({ code, eventId: event.id }, 'Event room opened');
  return room;
}

/** One lookup however many phones scan the code in the same moment. */
const roomLoads = new Map<string, Promise<MpRoom | 'ended' | null>>();
function loadEventRoom(code: string): Promise<MpRoom | 'ended' | null> {
  if (!eventHooks) return Promise.resolve(null);
  const pending = roomLoads.get(code);
  if (pending) return pending;
  const load: Promise<MpRoom | 'ended' | null> = eventHooks
    .load(code)
    .then<MpRoom | 'ended' | null>((found) =>
      found && found !== 'ended'
        ? createEventRoom(code, found.event, found.tracks, found.config)
        : (found as 'ended' | null),
    )
    .finally(() => roomLoads.delete(code));
  roomLoads.set(code, load);
  return load;
}

/** Registers a new WebSocket connection (no room membership yet — join_room binds it). */
export function registerConnection(input: {
  playerId: string;
  socket: MpSocket;
  identity: Identity;
}): void {
  sockets.set(input.playerId, input.socket);
  identities.set(input.playerId, input.identity);
}

export function unregisterConnection(playerId: string): void {
  dropFromRoom(playerId);
  passwordAttempts.delete(playerId);
  // A queued player whose socket died must come out of the line, or the next person to pick
  // that artist gets matched into a room nobody is going to join.
  duelQueue.dropPlayer(playerId);
  sockets.delete(playerId);
  identities.delete(playerId);
}

/**
 * The name this player appears under, or null after telling them why they cannot have it. Everyone
 * has a name: guests must type one, and it is checked here because the client's check is a courtesy.
 */
async function resolveDisplayName(
  playerId: string,
  identity: Identity,
  nickname?: string,
): Promise<string | null> {
  let name = nickname;
  if (!name && identity.userId) {
    const rows = await db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, identity.userId))
      .limit(1);
    name = rows[0]?.displayName;
  }
  if (!name) {
    sendTo(playerId, { type: 'error', code: 'name_required', message: 'Enter a name to join.' });
    return null;
  }
  if (isOffensiveName(name)) {
    sendTo(playerId, {
      type: 'error',
      code: 'name_rejected',
      message: 'That name is not allowed. Please choose another.',
    });
    return null;
  }
  return name;
}

export async function handleClientMessage(playerId: string, message: unknown): Promise<void> {
  if (typeof message !== 'object' || message === null) return;
  const { type, ...payload } = message as Record<string, unknown>;

  switch (type) {
    case 'join_room': {
      const code =
        typeof payload.code === 'string' ? payload.code.trim().toUpperCase().slice(0, 12) : '';
      const nickname =
        typeof payload.nickname === 'string' ? payload.nickname.trim().slice(0, 24) : undefined;
      const password = typeof payload.password === 'string' ? payload.password.slice(0, 100) : '';
      await joinRoom(playerId, code, nickname, password);
      break;
    }
    case 'leave_room':
      leaveRoom(playerId);
      break;
    case 'start_game':
      void startGame(playerId);
      break;
    case 'change_source': {
      const artistId = typeof payload.artistId === 'number' ? payload.artistId : undefined;
      const categoryId = typeof payload.categoryId === 'string' ? payload.categoryId : undefined;
      await changeSource(playerId, artistId, categoryId);
      break;
    }
    case 'reveal':
      revealMore(playerId);
      break;
    case 'guess': {
      const trackId =
        typeof payload.trackId === 'string' ? payload.trackId.slice(0, 32) : undefined;
      if (trackId) submitGuess(playerId, trackId);
      break;
    }
    case 'next_round':
      skipReveal(playerId);
      break;
    case 'ping':
      // Echoes the client's own timestamp, which is what lets it work out its clock offset.
      sendTo(playerId, { type: 'pong', t: payload.t, serverNow: Date.now() });
      break;

    case 'host_event':
      if (typeof payload.eventId === 'string' && typeof payload.code === 'string') {
        await attachHost(playerId, payload.eventId.slice(0, 64), payload.code.slice(0, 12));
      }
      break;
    case 'host_pause':
      withControl(playerId, pauseRoom);
      break;
    case 'host_resume':
      withControl(playerId, resumeRoom);
      break;
    case 'host_skip':
      withControl(playerId, skipCurrent);
      break;
    case 'host_stop_audio':
      withControl(playerId, (room) => broadcast(room, { type: 'stop_audio' }));
      break;
    case 'host_end':
      withControl(playerId, endEvent);
      break;
    case 'host_kick':
      if (typeof payload.playerId === 'string') {
        const target = payload.playerId;
        withControl(playerId, (room) => kickPlayer(room, target));
      }
      break;

    // Duel matchmaking rides the same socket rather than opening a second one: the connection
    // is already authenticated, and a player moves from the queue straight into a room.
    case 'duel_queue_join': {
      const request = parseDuelRequest(payload);
      if (request) await duelQueue.joinQueue(playerId, request);
      break;
    }
    case 'duel_queue_leave':
      duelQueue.leaveQueue(playerId);
      break;
    case 'duel_queue_watch':
      duelQueue.watchQueue(playerId);
      break;
    case 'duel_queue_unwatch':
      duelQueue.unwatchQueue(playerId);
      break;

    default:
      break;
  }
}

function parseDuelRequest(payload: Record<string, unknown>): duelQueue.DuelQueueRequest | null {
  if (payload.random === true) return { kind: 'random' };
  if (typeof payload.artistId === 'number') return { kind: 'artist', artistId: payload.artistId };
  // Checked before categoryId: movie collections are category sources underneath, so a client
  // sending both would otherwise be rated on the song ladder rather than the film one.
  if (typeof payload.soundtrackId === 'string') {
    return { kind: 'soundtrack', collectionId: payload.soundtrackId };
  }
  if (typeof payload.categoryId === 'string') {
    return { kind: 'category', categoryId: payload.categoryId };
  }
  return null;
}

const passwordAttempts = new Map<string, number>();

async function joinRoom(
  playerId: string,
  code: string,
  nickname?: string,
  password = '',
): Promise<void> {
  const current = playerRooms.get(playerId);
  if (current === code && rooms.get(code)?.players.has(playerId)) return;
  if (current && current !== code) leaveRoom(playerId);

  let room = rooms.get(code);
  if (!room) {
    const loaded = await loadEventRoom(code);
    if (loaded === 'ended') return sendError(playerId, 'That event has ended.');
    if (loaded) room = loaded;
  }
  if (!room) return sendError(playerId, 'Room not found, check the code and try again.');

  const identity = identities.get(playerId) ?? { userId: null, guestId: null };

  if (room.event) return joinEvent(room, playerId, identity, nickname, password);

  if (room.phase !== 'lobby') return sendError(playerId, 'That game is already in progress.');
  if (room.players.size >= room.maxPlayers) return sendError(playerId, 'Room is full.');

  // A duel's two seats are reserved for the accounts the matchmaker paired. Without this the
  // room code is a plain string that anyone could join, and a rated result would depend on who
  // happened to open the link.
  if (room.duel) {
    const uid = identity.userId;
    if (!uid || (uid !== room.duel.challengerUserId && uid !== room.duel.opponentUserId)) {
      return sendError(playerId, 'This duel is between two other players.');
    }
    for (const existing of room.players.values()) {
      if (existing.identity.userId === uid) {
        return sendError(playerId, 'You are already in this duel on another tab.');
      }
    }
  }

  const displayName = await resolveDisplayName(playerId, identity, nickname);
  // The lookup above yields, so re-check: the room may have filled, or the socket gone, meanwhile.
  if (!displayName || !sockets.has(playerId)) return;
  if (room.phase !== 'lobby') return sendError(playerId, 'That game is already in progress.');
  if (room.players.size >= room.maxPlayers) return sendError(playerId, 'Room is full.');

  const isHost = room.players.size === 0;
  const player: MpPlayer = {
    playerId,
    seatKey: playerId,
    disconnectedAt: null,
    roundAnswerMs: 0,
    displayName,
    identity,
    socket: sockets.get(playerId)!,
    isHost,
    score: 0,
    roundAnswered: false,
    roundCorrect: null,
    roundPoints: 0,
    stageIndex: 0,
    scoreAtRoundStart: 0,
    totalAnswerMs: 0,
    joinedAt: Date.now(),
  };

  room.players.set(playerId, player);
  playerRooms.set(playerId, room.code);
  if (isHost) room.hostId = playerId;

  broadcastRoomState(room);

  // A duel has no host to press start — it begins the moment both seats are filled. Deferred a
  // tick so the client that just joined has its room_state before round_start lands on top.
  if (room.duel && room.players.size === 2 && room.phase === 'lobby') {
    const starter = room.hostId;
    room.timers.push(setTimeout(() => void startGame(starter), 400));
  }
}

const seatKeyFor = (identity: Identity, playerId: string): string =>
  identity.userId ?? identity.guestId ?? playerId;

/**
 * Takes or retakes an event seat.
 *
 * Unlike a friends' room this works at any point in the game: the same identity gets its score
 * back, and someone new starts from zero at whichever round is running. A phone in a lecture hall
 * loses signal or sleeps all the time, and an event cannot treat that as walking out.
 */
async function joinEvent(
  room: MpRoom,
  playerId: string,
  identity: Identity,
  nickname: string | undefined,
  password: string,
): Promise<void> {
  const event = room.event!;
  const seatKey = seatKeyFor(identity, playerId);
  if (room.kicked.has(seatKey)) return sendError(playerId, 'The host removed you from this event.');
  if (room.phase === 'finished') return sendError(playerId, 'That event has ended.');

  const seat = room.seats.get(seatKey);
  const isOwner = identity.userId === event.ownerUserId;
  if (!seat) {
    if (event.passwordHash && !isOwner && !eventHooks?.checkPassword(event, password)) {
      const attempts = (passwordAttempts.get(playerId) ?? 0) + 1;
      passwordAttempts.set(playerId, attempts);
      sendTo(playerId, {
        type: 'error',
        code: password ? 'wrong_password' : 'password_required',
        message: password ? 'That password is not right.' : 'This event needs a password.',
      });
      if (attempts >= MAX_PASSWORD_ATTEMPTS)
        sockets.get(playerId)?.close(1008, 'Too many attempts');
      return;
    }
    const displayName = await resolveDisplayName(playerId, identity, nickname);
    if (!displayName || !sockets.has(playerId)) return;
    if (room.seats.has(seatKey)) return joinEvent(room, playerId, identity, nickname, password);
    if (room.seats.size >= room.maxPlayers) return sendError(playerId, 'This event is full.');

    const player: MpPlayer = {
      playerId,
      seatKey,
      disconnectedAt: null,
      roundAnswerMs: 0,
      displayName,
      identity,
      socket: sockets.get(playerId)!,
      isHost: isOwner,
      score: 0,
      // Someone arriving mid-round has that round to play.
      roundAnswered: false,
      roundCorrect: null,
      roundPoints: 0,
      stageIndex: 0,
      scoreAtRoundStart: 0,
      totalAnswerMs: 0,
      joinedAt: Date.now(),
    };
    room.seats.set(seatKey, player);
    room.players.set(playerId, player);
  } else if (seat.playerId !== playerId) {
    // The same person on a new socket. The old one is told why, and must not reconnect over this.
    count('reconnects');
    const old = sockets.get(seat.playerId);
    room.players.delete(seat.playerId);
    playerRooms.delete(seat.playerId);
    old?.close(4001, 'Opened somewhere else');
    seat.playerId = playerId;
    seat.socket = sockets.get(playerId)!;
    seat.disconnectedAt = null;
    room.players.set(playerId, seat);
  } else {
    seat.disconnectedAt = null;
  }
  playerRooms.set(playerId, room.code);
  room.lastActiveAt = Date.now();

  sendCatchUp(room, playerId);
  broadcastRoomState(room);
}

/** Everything a player arriving now needs: the room, and the round in progress if there is one. */
function sendCatchUp(room: MpRoom, playerId: string): void {
  sendTo(playerId, { type: 'room_state', room: buildRoomSnapshot(room) });
  const player = room.players.get(playerId);
  if ((room.phase === 'playing' || room.phase === 'round-reveal') && player) {
    sendRoundStart(room, player);
    if (player.roundAnswered) {
      sendTo(playerId, {
        type: 'guess_result',
        stageIndex: player.stageIndex,
        yourRank: room.roundRanks.get(player.seatKey) ?? room.players.size,
        totalPlayers: room.players.size,
      });
    }
    sendTo(playerId, scoresFrame(room));
  }
  if (room.phase === 'round-reveal') sendTo(playerId, roundEndFrame(room));
  if (room.paused) sendTo(playerId, { type: 'paused', remainingMs: room.paused.remainingMs });
}

/** A dead socket, as opposed to a player choosing to leave. Only events keep the seat. */
function dropFromRoom(playerId: string): void {
  const code = playerRooms.get(playerId);
  const room = code ? rooms.get(code) : undefined;
  if (!room?.event || room.phase === 'finished') return leaveRoom(playerId);

  playerRooms.delete(playerId);
  if (room.hostId === playerId) room.hostId = '';
  const player = room.players.get(playerId);
  if (player) player.disconnectedAt = Date.now();
  room.lastActiveAt = Date.now();
  resolveRoundIfComplete(room);
  broadcastRoomState(room);
}

/** Players the round is still waiting for. Someone with no connection cannot answer. */
function resolveRoundIfComplete(room: MpRoom): void {
  if (room.phase !== 'playing' || room.paused) return;
  for (const p of room.players.values()) {
    if (
      !p.roundAnswered &&
      p.disconnectedAt === null &&
      !(p.playerId === room.hostId && !room.hostPlayable)
    ) {
      return;
    }
  }
  // Nobody connected at all is an empty hall, not a finished round: let the clock decide.
  if (room.event && ![...room.players.values()].some((p) => p.disconnectedAt === null)) return;
  endRound(room);
}

// --- Event host controls ------------------------------------------------------------------

/**
 * Makes this socket the event's controller.
 *
 * Controlling and playing are separate things: the controller is not in `players`, so holds no
 * seat, no score and no place on the leaderboard unless the event says the host plays too. The
 * role is re-read from the database here rather than trusted from when the socket opened.
 */
async function attachHost(playerId: string, eventId: string, code: string): Promise<void> {
  const identity = identities.get(playerId);
  const userId = identity?.userId;
  const loaded = rooms.get(code) ?? (await loadEventRoom(code));
  const room = loaded && loaded !== 'ended' && loaded.event?.id === eventId ? loaded : null;
  const refuse = () =>
    sendTo(playerId, {
      type: 'error',
      code: 'not_host',
      message: 'Only the event host can do that.',
    });
  if (!userId || !eventHooks || !(await eventHooks.canHost(userId))) return refuse();
  if (!room || room.event?.ownerUserId !== userId) return refuse();
  if (!sockets.has(playerId)) return;

  const previous = room.hostId;
  if (previous && previous !== playerId) {
    playerRooms.delete(previous);
    sockets.get(previous)?.close(4001, 'Opened somewhere else');
  }
  room.hostId = playerId;
  playerRooms.set(playerId, room.code);
  room.lastActiveAt = Date.now();

  if (room.event!.hostPlays) await joinEvent(room, playerId, identity!, undefined, '');
  else sendCatchUp(room, playerId);
  sendHostRound(room);
  broadcastRoomState(room);
}

function withControl(playerId: string, action: (room: MpRoom) => void): void {
  const room = roomFor(playerId);
  if (!room?.event || room.hostId !== playerId) {
    return sendTo(playerId, {
      type: 'error',
      code: 'not_host',
      message: 'Only the event host can do that.',
    });
  }
  action(room);
}

/** The song, for the host's device only. Sent in both audio modes; only host_only plays it. */
function sendHostRound(room: MpRoom): void {
  if (!room.hostId || (room.phase !== 'playing' && room.phase !== 'round-reveal')) return;
  const track = room.tracks[room.currentRound];
  sendTo(room.hostId, {
    type: 'host_round',
    roundIndex: room.currentRound,
    totalRounds: room.rounds,
    playAt: room.roundStartedAt,
    playbackSeconds: room.speedSnippetSeconds,
    roundEndsAt: room.phaseEndsAt,
    previewUrl: room.previewUrls[room.currentRound] ?? null,
    title: track?.title ?? null,
    artist: track?.artist ?? null,
    albumArtUrl: track?.albumArtUrl ?? null,
  });
}

function pauseRoom(room: MpRoom): void {
  if (room.paused || (room.phase !== 'playing' && room.phase !== 'round-reveal')) return;
  clearRoomTimers(room);
  room.paused = { at: Date.now(), remainingMs: Math.max(0, room.phaseEndsAt - Date.now()) };
  broadcast(room, { type: 'paused', remainingMs: room.paused.remainingMs });
}

function resumeRoom(room: MpRoom): void {
  if (!room.paused) return;
  const { at, remainingMs } = room.paused;
  room.paused = null;
  // The clock simply did not run: answer times and audio position both stay continuous.
  room.roundStartedAt += Date.now() - at;
  schedulePhaseEnd(room, remainingMs);
  broadcast(room, {
    type: 'resumed',
    startedAt: room.roundStartedAt,
    phaseEndsAt: room.phaseEndsAt,
    serverNow: Date.now(),
  });
  sendHostRound(room);
}

function schedulePhaseEnd(room: MpRoom, delayMs: number): void {
  room.phaseEndsAt = Date.now() + delayMs;
  room.timers.push(
    setTimeout(() => {
      if (room.phase === 'playing') endRound(room);
      else if (room.phase === 'round-reveal') advanceRound(room);
    }, delayMs),
  );
}

function advanceRound(room: MpRoom): void {
  clearRoomTimers(room);
  room.paused = null;
  if (room.currentRound >= room.rounds - 1) finishGame(room);
  else if (room.event) void startEventRound(room, room.currentRound + 1);
  else startRound(room, room.currentRound + 1);
}

/** A round that did not count: nobody keeps points from a song the host threw out. */
function rollBackRound(room: MpRoom): void {
  for (const p of room.players.values()) {
    p.score = p.scoreAtRoundStart;
    p.totalAnswerMs -= p.roundAnswerMs;
    p.roundAnswerMs = 0;
    p.roundCorrect = null;
    p.roundPoints = 0;
  }
}

function skipCurrent(room: MpRoom): void {
  if (room.phase === 'playing') rollBackRound(room);
  else if (room.phase !== 'round-reveal') return;
  broadcast(room, { type: 'stop_audio' });
  advanceRound(room);
}

function endEvent(room: MpRoom): void {
  if (room.phase === 'finished') return;
  if (room.phase === 'playing') rollBackRound(room);
  clearRoomTimers(room);
  room.paused = null;
  broadcast(room, { type: 'stop_audio' });
  finishGame(room);
}

function kickPlayer(room: MpRoom, targetId: string): void {
  const target = room.players.get(targetId);
  if (!target) return;
  room.kicked.add(target.seatKey);
  room.seats.delete(target.seatKey);
  room.players.delete(targetId);
  playerRooms.delete(targetId);
  sendTo(targetId, { type: 'kicked', message: 'The host removed you from this event.' });
  sockets.get(targetId)?.close(4002, 'Removed by host');
  resolveRoundIfComplete(room);
  broadcastRoomState(room);
}

/**
 * Finds the next song that will actually play, and starts it.
 *
 * Previews are signed for about fifteen minutes, so a long event cannot resolve them all up
 * front: they are fetched as each round comes up, and a song Deezer no longer serves is dropped
 * rather than stopping the event.
 */
async function startEventRound(room: MpRoom, roundIndex: number): Promise<void> {
  for (let index = roundIndex; index < room.rounds; index += 1) {
    const track = room.tracks[index];
    if (!track) break;
    const preview = await getFreshPreviewUrl(track.deezerTrackId).catch(() => null);
    if (!rooms.has(room.code) || room.phase === 'finished') return;
    if (preview) {
      room.previewUrls[index] = preview.previewUrl;
      startRound(room, index);
      return;
    }
    logger.warn(
      { code: room.code, deezerTrackId: track.deezerTrackId },
      'Event song has no audio; skipping',
    );
    if (room.hostId) {
      sendTo(room.hostId, {
        type: 'song_skipped',
        title: track.title,
        reason: 'No audio available from Deezer',
      });
    }
  }
  finishGame(room);
}

export function leaveRoom(playerId: string): void {
  const code = playerRooms.get(playerId);
  if (!code) return;
  playerRooms.delete(playerId);

  const room = rooms.get(code);
  if (!room) return;

  const leaver = room.players.get(playerId);
  room.players.delete(playerId);
  if (leaver) room.seats.delete(leaver.seatKey);
  room.lastActiveAt = Date.now();

  if (room.event) {
    if (room.hostId === playerId) room.hostId = '';
    resolveRoundIfComplete(room);
    broadcastRoomState(room);
    return;
  }

  /*
   * Walking out of a rated duel in progress is a loss, not an escape.
   *
   * Without this, the way to avoid dropping rating would be to close the tab whenever you were
   * behind, which makes the rating meaningless — every recorded result would be one somebody
   * chose to let finish. Settled before the empty-room check below, because the leaver is
   * frequently the second-to-last socket and the room is about to be destroyed.
   */
  // `starting` is excluded deliberately: the pool is still being built and nobody has heard a
  // note, so leaving there is abandoning a lobby rather than fleeing a duel that is under way.
  if (
    room.duel &&
    !room.duel.settled &&
    room.phase !== 'lobby' &&
    room.phase !== 'starting' &&
    room.phase !== 'finished'
  ) {
    const survivor = [...room.players.values()][0];
    if (leaver?.identity.userId && survivor?.identity.userId) {
      void settleDuelRoom(room, {
        winnerUserId: survivor.identity.userId,
        loserUserId: leaver.identity.userId,
        forfeited: true,
      });
      broadcast(room, {
        type: 'duel_forfeit',
        winnerUserId: survivor.identity.userId,
        message: 'Your opponent left — the duel is yours.',
      });
    }
  }

  if (room.players.size === 0) {
    destroyRoom(room);
    return;
  }

  if (room.hostId === playerId) {
    const next = room.players.values().next().value as MpPlayer | undefined;
    if (next) {
      next.isHost = true;
      room.hostId = next.playerId;
    }
  }

  // A player leaving mid-round might have been the only one still guessing — check whether
  // the round can now be resolved early.
  if (room.phase === 'playing') {
    const remaining = [...room.players.values()].filter((p) => !p.roundAnswered);
    if (remaining.length === 0) {
      endRound(room);
      return;
    }
  }

  broadcastRoomState(room);
}

/**
 * Repoints a finished room at a different artist or category and returns it to the lobby.
 *
 * Without this the only way to race something new was to abandon the room and re-share a code,
 * which scatters the group every single time — everyone re-scans, re-types a name, and someone
 * always ends up in the old room. Swapping the source in place keeps the players, the host and
 * the scoreboard history where they are; only the pool changes.
 */
export async function changeSource(
  playerId: string,
  artistId?: number,
  categoryId?: string,
): Promise<void> {
  const room = roomFor(playerId);
  if (!room) return;
  if (room.hostId !== playerId) return sendError(playerId, 'Only the host can change the music.');
  if (room.event) return sendError(playerId, 'An event plays its own playlist.');
  if (room.phase === 'playing' || room.phase === 'round-reveal') {
    return sendError(playerId, 'Finish the current game first.');
  }
  if ((artistId != null) === (categoryId != null)) {
    return sendError(playerId, 'Pick exactly one artist or category.');
  }

  let source: ChallengeSource;
  try {
    source =
      artistId != null
        ? await resolveArtistSource(artistId, false)
        : resolveCategorySource(categoryId!);
  } catch {
    return sendError(playerId, artistId != null ? 'Artist not found.' : 'Unknown category.');
  }

  clearRoomTimers(room);
  room.source = source;
  room.phase = 'lobby';
  room.tracks = [];
  room.previewUrls = [];
  room.roundOptions = [];
  room.currentRound = 0;
  room.speedCorrectCount = 0;

  // Scores reset with the source: carrying them over would mean the new race starts with
  // someone already ahead for songs nobody in this game heard.
  for (const p of room.players.values()) {
    p.score = 0;
    p.roundAnswered = false;
    p.roundCorrect = null;
    p.roundPoints = 0;
    p.stageIndex = 0;
  }

  logger.info(
    { code: room.code, sourceType: source.sourceType, sourceId: source.sourceId },
    'Multiplayer room source changed',
  );
  broadcastRoomState(room);
}

export async function startGame(playerId: string): Promise<void> {
  const room = roomFor(playerId);
  if (!room) return;
  if (room.hostId !== playerId) return sendError(playerId, 'Only the host can start the game.');
  if (room.phase !== 'lobby' && (room.phase !== 'finished' || room.event)) {
    return sendError(playerId, 'Game already in progress.');
  }

  if (room.event && room.players.size === 0) {
    return sendError(playerId, 'Nobody has joined yet.');
  }

  // Claimed synchronously, before the first await. Everything below can take tens of seconds on
  // a cold pool, and until this is set a second `start_game` would pass the phase check above
  // and run the whole build again in parallel.
  room.phase = 'starting';
  broadcastRoomState(room);

  /** Puts the room back in the lobby so the host can try again after anything that failed. */
  const abort = (message: string) => {
    room.phase = 'lobby';
    broadcastRoomState(room);
    sendError(playerId, message);
  };

  if (room.event) {
    try {
      await prepareEvent(room);
    } catch (err) {
      logger.error({ err, code: room.code }, 'Failed to start event');
      abort('Could not start the event, please try again.');
    }
    return;
  }

  try {
    const pool = await room.source.loadCatalog();
    if (pool.length < MP_MIN_ROUNDS) {
      return abort(
        `${room.source.label} only has ${pool.length} playable ${
          pool.length === 1 ? 'song' : 'songs'
        } — not enough for a game.`,
      );
    }
    // Play short rather than refusing. A thin catalogue (K/DA and similar) used to fail here
    // with a message that read like a bug rather than "this artist has six songs".
    if (pool.length < room.rounds) {
      room.rounds = pool.length;
    }

    const seed = `${room.code}:${Date.now()}:${randomUUID()}`;
    const shuffled = seededShuffle(pool, seed);

    // Check candidate tracks in parallel to obtain at least `room.rounds` with playable audio
    const candidateTracks = shuffled.slice(0, room.rounds * 2);
    const candidatePreviews = await Promise.all(
      candidateTracks.map((t) => getFreshPreviewUrl(t.deezerTrackId)),
    );

    const chosen: typeof pool = [];
    const previews: string[] = [];

    for (let i = 0; i < candidateTracks.length; i++) {
      if (chosen.length >= room.rounds) break;
      const p = candidatePreviews[i];
      const track = candidateTracks[i];
      if (p != null && track != null) {
        chosen.push(p.artist ? { ...track, artist: p.artist } : track);
        previews.push(p.previewUrl);
      }
    }

    if (chosen.length < room.rounds) {
      const remainingTracks = shuffled.slice(room.rounds * 2);
      for (const track of remainingTracks) {
        if (chosen.length >= room.rounds) break;
        const p = await getFreshPreviewUrl(track.deezerTrackId);
        if (p != null) {
          chosen.push(p.artist ? { ...track, artist: p.artist } : track);
          previews.push(p.previewUrl);
        }
      }
    }

    if (chosen.length < room.rounds) {
      return abort(`Not enough tracks with playable audio available for ${room.source.label}.`);
    }

    room.tracks = chosen;
    room.previewUrls = previews;
    // Decoys are drawn once, here, rather than per player: everyone must be shown the same
    // answers or the round is not a fair race.
    room.roundOptions =
      room.guessMode === 'choice'
        ? chosen.map((track) =>
            buildRoundOptions(track, pool, MP_CHOICE_OPTIONS, room.source.answerIsTitle),
          )
        : [];

    for (const p of room.players.values()) {
      p.score = 0;
      p.scoreAtRoundStart = 0;
      p.totalAnswerMs = 0;
      p.roundAnswered = false;
      p.roundCorrect = null;
      p.roundPoints = 0;
      p.stageIndex = 0;
    }

    broadcastRoomState(room);
    startRound(room, 0);
  } catch (err) {
    logger.error({ err }, 'Failed to start multiplayer game');
    // Without this the room would be stuck in `starting` forever, with a spinner and no way
    // back: the phase check at the top would reject every retry.
    abort('Could not start the game, please try again.');
  }
}

/** An event plays its playlist in the order the host set, for as many rounds as it asked for. */
async function prepareEvent(room: MpRoom): Promise<void> {
  const pool = await room.source.loadCatalog();
  room.tracks = pool.slice(0, room.rounds);
  room.rounds = room.tracks.length;
  room.previewUrls = room.tracks.map(() => '');
  room.roundOptions = room.tracks.map((track) =>
    buildRoundOptions(track, pool, MP_CHOICE_OPTIONS, false),
  );
  for (const p of room.players.values()) {
    p.score = 0;
    p.scoreAtRoundStart = 0;
    p.totalAnswerMs = 0;
  }
  eventHooks?.onStarted(room.event!.id);
  await startEventRound(room, 0);
}

function startRound(room: MpRoom, roundIndex: number): void {
  clearRoomTimers(room);

  for (const p of room.players.values()) {
    p.roundAnswered = p.playerId === room.hostId && !room.hostPlayable;
    p.roundCorrect = null;
    p.roundPoints = 0;
    p.roundAnswerMs = 0;
    p.stageIndex = 0;
    // Freeze the total the scoreboard shows for the duration of the round.
    p.scoreAtRoundStart = p.score;
  }

  room.currentRound = roundIndex;
  room.phase = 'playing';
  // An event's clock starts when the music does, a moment from now, on every device at once.
  const lead = room.event ? EVENT_ROUND_LEAD_MS : 0;
  room.roundStartedAt = Date.now() + lead;
  room.speedCorrectCount = 0;
  room.roundRanks = new Map(rankedPlayers(room).map((p, i) => [p.seatKey, i + 1]));

  const roundDuration =
    room.gameMode === 'speed' ? room.speedRoundDurationMs : room.roundDurationMs;

  /*
   * Sent per player rather than broadcast, so everyone gets the same four options in a
   * different order.
   *
   * The *set* has to match or the round is not a fair race, but a shared order turns the game
   * into "watch the person next to you" — one player answering fast tells the rest which
   * position to tap, and on a phone that is faster than recognising the song. Shuffling the
   * arrangement keeps the race about the audio.
   *
   * Seeded on player and round rather than randomised per send: a reconnect mid-round would
   * otherwise deal a new arrangement and move the answer out from under someone's finger.
   */
  for (const player of room.players.values()) sendRoundStart(room, player);

  /*
   * Publish the cleared per-round state.
   *
   * The reset above only happened in memory: `round_start` carries the new song but says nothing
   * about who has answered, so every client was still holding the previous round's scores, where
   * everyone reads as answered. That left the guess UI disabled from round two onwards — you
   * could play the first song and then nothing else.
   */
  broadcast(room, scoresFrame(room));

  schedulePhaseEnd(room, lead + roundDuration);
  sendHostRound(room);
}

function sendRoundStart(room: MpRoom, player: MpPlayer): void {
  const roundIndex = room.currentRound;
  const track = room.tracks[roundIndex];
  const isSpeed = room.gameMode === 'speed';
  const options = room.roundOptions[roundIndex] ?? [];
  // Seeded on the seat, which a reconnect keeps, so the answers do not move under someone's finger.
  const seed = `${room.event ? player.seatKey : player.playerId}:${roundIndex}`;
  // Host-only audio: a player's device is never told what to play, not merely told not to.
  const hearsAudio = !room.hostOnlyAudio || player.playerId === room.hostId;
  sendTo(player.playerId, {
    type: 'round_start',
    roundIndex,
    totalRounds: room.rounds,
    startedAt: room.roundStartedAt,
    serverNow: Date.now(),
    roundDurationMs: isSpeed ? room.speedRoundDurationMs : room.roundDurationMs,
    snippetSchedule: isSpeed ? [room.speedSnippetSeconds] : room.revealSchedule,
    previewUrl: hearsAudio ? (room.previewUrls[roundIndex] ?? null) : null,
    albumArtUrl: track?.albumArtUrl ?? null,
    pictureUrl: room.source.pictureUrl,
    revealDurationMs: room.revealDurationMs,
    guessMode: room.guessMode,
    gameMode: room.gameMode,
    ...(room.guessMode === 'choice' ? { options: seededShuffle(options, seed) } : {}),
  });
}

/** Extends this player's own snippet one stage further along the reveal schedule. */
function revealMore(playerId: string): void {
  const room = roomFor(playerId);
  if (!room) return;
  if (room.gameMode === 'speed') return;
  if (room.phase !== 'playing') return sendError(playerId, 'No round is in progress.');
  const player = room.players.get(playerId);
  if (!player) return;
  if (player.roundAnswered) return sendError(playerId, 'Already answered this round.');

  const maxStage = room.revealSchedule.length - 1;
  if (player.stageIndex >= maxStage) return;

  player.stageIndex += 1;
  sendTo(playerId, { type: 'stage', stageIndex: player.stageIndex });
  publishScores(room);
}

function submitGuess(playerId: string, trackId: string): void {
  const handledFrom = performance.now();
  const room = roomFor(playerId);
  if (!room) return;
  if (room.phase !== 'playing' || room.paused) {
    return sendError(playerId, 'No round is in progress.');
  }
  const player = room.players.get(playerId);
  if (!player) return;
  if (player.roundAnswered) return sendError(playerId, 'Already answered this round.');
  // Options reach phones before the music starts. Answering before it starts is not a thing.
  if (Date.now() < room.roundStartedAt) return sendError(playerId, 'The song has not started yet.');

  const track = room.tracks[room.currentRound];
  const correct = track?.deezerTrackId === trackId;
  const isSpeed = room.gameMode === 'speed';

  /*
   * How long this answer took. Counted for everyone, right or wrong, so the tie breaker
   * measures decisiveness across the whole game rather than only the rounds you got.
   */
  const roundDuration = isSpeed ? room.speedRoundDurationMs : room.roundDurationMs;
  const elapsedMs = Math.max(0, Math.min(roundDuration, Date.now() - room.roundStartedAt));
  player.totalAnswerMs += elapsedMs;
  player.roundAnswerMs = elapsedMs;

  let points = 0;
  if (correct) {
    if (isSpeed) {
      points = speedPointsFor(room, elapsedMs, roundDuration);
      room.speedCorrectCount += 1;
    } else {
      points = MP_REVEAL_POINTS[player.stageIndex] ?? 1;
    }
  }

  player.score += points;
  player.roundAnswered = true;
  player.roundCorrect = correct;
  player.roundPoints = points;

  /*
   * Deliberately does not say whether the guess was right.
   *
   * The answer arrives with the reveal, the same moment everyone else gets it — being told
   * privately turns the rest of the round into either a formality or a wait you already know
   * the result of, and in a room where people are talking it leaks to the others too.
   *
   * `guessedTrackId` is echoed so the client can keep the chosen option marked without having
   * to remember what it sent across a reconnect.
   */
  sendTo(playerId, {
    type: 'guess_result',
    stageIndex: player.stageIndex,
    guessedTrackId: trackId,
    // Your standing, which the shared scoreboard frame cannot carry: it only holds the top ten,
    // and in a big room you are almost certainly not in it.
    yourRank: room.roundRanks.get(player.seatKey) ?? room.players.size,
    totalPlayers: room.players.size,
  });
  publishScores(room);
  resolveRoundIfComplete(room);
  answerProcessingMs.add(performance.now() - handledFrom);
}

/**
 * What a correct speed answer is worth.
 *
 * Order alone was the whole score before, which made the round a race to click rather than a
 * race to *know*: answering at one second and answering at fourteen paid the same as long as
 * nobody beat you to it, and in a two-player room second place was second place no matter how
 * close it was.
 *
 * So the bulk of the score decays with the clock, and being first adds a smaller bonus on top.
 * Both matter, but the time you took matters more — which is the behaviour the mode is named
 * after.
 */
function speedPointsFor(room: MpRoom, elapsedMs: number, roundDurationMs: number): number {
  const timeScore = timeDecayScore({
    elapsed: elapsedMs,
    window: roundDurationMs,
    max: room.speedMaxPoints,
    min: room.speedMinPoints,
  });

  const orderIndex = Math.min(room.speedCorrectCount, room.speedPoints.length - 1);
  const orderBonus = room.speedPoints[orderIndex] ?? 0;

  return Math.max(0, timeScore + orderBonus);
}

function roundEndFrame(room: MpRoom): Record<string, unknown> {
  const track = room.tracks[room.currentRound];
  return {
    type: 'round_end',
    /*
     * When the reveal actually ends, rather than leaving the client to infer it.
     *
     * A round can finish early — the moment everyone has answered — but the client was working
     * the reveal countdown out from `startedAt + roundDurationMs`, the time the round was
     * *scheduled* to end. Answer a round in five seconds and that instant is still twenty-odd
     * seconds away, so the reveal counted down from a number that had nothing to do with when
     * the next round would start.
     */
    revealEndsAt: room.phaseEndsAt,
    correct: track
      ? {
          title: track.title,
          artist: track.artist,
          albumArtUrl: track.albumArtUrl,
          // Sent so the reveal can play the song rather than only name it — hearing the bit
          // you missed is most of why the answer is worth showing at all. Host-only rooms play
          // through one speaker, so the reveal stays there too.
          previewUrl: room.hostOnlyAudio ? null : (room.previewUrls[room.currentRound] ?? null),
        }
      : null,
    scores: buildScores(room, true),
  };
}

function endRound(room: MpRoom): void {
  if (room.phase !== 'playing') return;
  clearRoomTimers(room);
  if (room.scoresTimer) clearTimeout(room.scoresTimer);
  room.scoresTimer = null;
  room.paused = null;
  room.phase = 'round-reveal';
  schedulePhaseEnd(room, room.revealDurationMs);

  broadcast(room, roundEndFrame(room));
  if (room.hostOnlyAudio && room.hostId) {
    sendTo(room.hostId, {
      type: 'reveal_audio',
      previewUrl: room.previewUrls[room.currentRound] ?? null,
    });
  }
  // Each player's own place, since the scores frame stops at ten. One sort, one tiny frame each.
  rankedPlayers(room).forEach((p, i) =>
    sendTo(p.playerId, {
      type: 'standing',
      rank: i + 1,
      score: p.score,
      totalPlayers: room.players.size,
    }),
  );

  // Looked up now so the next round starts on time rather than waiting on Deezer.
  const next = room.event ? room.tracks[room.currentRound + 1] : undefined;
  if (next) void getFreshPreviewUrl(next.deezerTrackId).catch(() => null);
}

function skipReveal(playerId: string): void {
  const room = roomFor(playerId);
  if (!room) return;
  if (room.phase !== 'round-reveal') return;
  if (room.hostId !== playerId) return sendError(playerId, 'Only the host can skip the reveal.');

  advanceRound(room);
}

function finishGame(room: MpRoom): void {
  room.phase = 'finished';
  const scores = buildScores(room, true);
  if (room.event) {
    eventHooks?.onFinished(
      room.event.id,
      room.players.size,
      scores.map((s) => ({ rank: s.rank, displayName: s.displayName, score: s.score })),
    );
  }
  broadcast(room, {
    type: 'game_over',
    scores,
    winner: computeWinner(scores),
    /*
     * Everything the room just played, so the results screen can be a listenable set list.
     * The rounds go past quickly and the songs you did not get are the ones worth hearing
     * again; without this the game ends on a scoreboard and the music disappears.
     */
    songs: room.tracks.map((track, index) => ({
      title: track.title,
      artist: track.artist,
      albumArtUrl: track.albumArtUrl,
      previewUrl: room.previewUrls[index] ?? null,
    })),
  });

  if (room.duel && !room.duel.settled) {
    void settleDuelRoomFromScores(room);
  }
}

/**
 * Turns the room's final scores into a rated result.
 *
 * Higher score wins. A genuine draw — level on points *and* on total answer time — stays a
 * draw; a tie on points alone goes to whoever was quicker across the game, because a duel that
 * came down to reaction speed should not be recorded as if neither player edged it.
 */
async function settleDuelRoomFromScores(room: MpRoom): Promise<void> {
  const duel = room.duel;
  if (!duel) return;

  const byUser = new Map<string, { score: number; totalAnswerMs: number }>();
  for (const p of room.players.values()) {
    if (p.identity.userId) {
      byUser.set(p.identity.userId, { score: p.score, totalAnswerMs: p.totalAnswerMs });
    }
  }
  const challenger = byUser.get(duel.challengerUserId) ?? { score: 0, totalAnswerMs: 0 };
  const opponent = byUser.get(duel.opponentUserId) ?? { score: 0, totalAnswerMs: 0 };

  let { score: challengerScore } = challenger;
  let { score: opponentScore } = opponent;

  // Nudge the reported score by one so the settlement, which only compares numbers, records
  // the faster player as the winner rather than a draw.
  if (challengerScore === opponentScore && challenger.totalAnswerMs !== opponent.totalAnswerMs) {
    if (challenger.totalAnswerMs < opponent.totalAnswerMs) challengerScore += 1;
    else opponentScore += 1;
  }

  await settleDuelRoom(room, {
    challengerScore,
    opponentScore,
    forfeited: false,
  });
}

/**
 * Writes the duel row and moves both ratings.
 *
 * Marks `settled` synchronously *before* awaiting anything: a forfeit and a natural finish can
 * both reach this in the same tick, and a rating applied twice is not something a later read
 * can untangle.
 */
async function settleDuelRoom(
  room: MpRoom,
  outcome:
    | { challengerScore: number; opponentScore: number; forfeited: false }
    | { winnerUserId: string; loserUserId: string; forfeited: true },
): Promise<void> {
  const duel = room.duel;
  if (!duel || duel.settled) return;
  duel.settled = true;

  const challengerScore = outcome.forfeited
    ? outcome.winnerUserId === duel.challengerUserId
      ? 1
      : 0
    : outcome.challengerScore;
  const opponentScore = outcome.forfeited
    ? outcome.winnerUserId === duel.opponentUserId
      ? 1
      : 0
    : outcome.opponentScore;

  try {
    const settled = await recordLiveDuel({
      challengerUserId: duel.challengerUserId,
      opponentUserId: duel.opponentUserId,
      challengerScore,
      opponentScore,
      sourceType: duel.sourceType,
      sourceId: duel.sourceId,
      label: duel.label,
      forfeited: outcome.forfeited,
      mode: duel.mode,
    });
    broadcast(room, { type: 'duel_result', duel: settled });
  } catch (err) {
    // A failed settle must not take the room with it — the players still get their scoreboard.
    logger.error({ err, code: room.code }, 'Failed to settle duel');
  }
}

function computeWinner(
  scores: MpScoreEntry[],
): { playerId: string; displayName: string; score: number } | null {
  if (scores.length === 0) return null;
  // Same rule as the scoreboard: level on points, the quicker player takes it.
  const top = scores.reduce((a, b) => {
    if (b.score !== a.score) return b.score > a.score ? b : a;
    return b.totalAnswerMs < a.totalAnswerMs ? b : a;
  });
  return { playerId: top.playerId, displayName: top.displayName, score: top.score };
}

/**
 * The scoreboard, with the round's outcome withheld until it is revealed.
 *
 * Whether a guess was right is deliberately not sent while the round is running — not to the
 * player who made it, and not to anyone watching. Three things would otherwise give it away:
 * the `correctThisRound` flag, the running total moving, and the ✓/✗ the client draws from
 * them. Masking here rather than in the UI means no client can leak it, including a future one.
 *
 * `answered` stays truthful throughout: knowing *that* someone has locked in is part of the
 * tension, and it is what the guess UI uses to stop you answering twice.
 */
/**
 * How many rows a scoreboard broadcast carries.
 *
 * Serialising once fixed the CPU cost, but not the bandwidth: a row per player is about 100
 * bytes, so a 10,000-player room is a megabyte per broadcast, times 10,000 sockets, on every
 * guess. No amount of CPU tuning survives that.
 *
 * A cap is also the honest UI. Nobody reads past the top of a leaderboard with thousands of
 * names on it.
 *
 * Ten rows, and your own position travels separately: `rankFor` below computes it, and it rides
 * the guess result, which is already addressed to one player. That keeps the expensive part
 * shared and the personal part O(1) per guess rather than O(N) per broadcast.
 */
const MAX_BROADCAST_SCORES = 10;

/**
 * Everyone, best first, on the score the room is allowed to see: the total at round start while
 * a round runs (the same masking as buildScores), the real total once it is revealed.
 */
function rankedPlayers(room: MpRoom): MpPlayer[] {
  const shown = (p: MpPlayer) => (room.phase === 'playing' ? p.scoreAtRoundStart : p.score);
  // Join time last (the sort is stable), so level players never swap places between two frames.
  return [...room.players.values()].sort(
    (a, b) => shown(b) - shown(a) || a.totalAnswerMs - b.totalAnswerMs || a.joinedAt - b.joinedAt,
  );
}

function buildScores(room: MpRoom, reveal = false): MpScoreEntry[] {
  const shown = (p: MpPlayer) => (reveal ? p.score : p.scoreAtRoundStart);
  const sorted = [...room.players.values()].sort(
    (a, b) => shown(b) - shown(a) || a.totalAnswerMs - b.totalAnswerMs || a.joinedAt - b.joinedAt,
  );
  const rows: MpScoreEntry[] = [];
  // Sorted on whatever score is being reported, so the order cannot jump a round early, then cut
  // so what goes is the bottom of the ranking rather than whoever was late in the map.
  for (let i = 0; i < Math.min(sorted.length, MAX_BROADCAST_SCORES); i += 1) {
    const p = sorted[i]!;
    const prev = sorted[i - 1];
    const tied =
      prev && shown(prev) === shown(p) && prev.totalAnswerMs === p.totalAnswerMs && rows[i - 1];
    rows.push({
      playerId: p.playerId,
      displayName: p.displayName,
      score: shown(p),
      totalAnswerMs: p.totalAnswerMs,
      answered: p.roundAnswered,
      correctThisRound: reveal ? p.roundCorrect : null,
      stageIndex: p.stageIndex,
      rank: tied ? rows[i - 1]!.rank : i + 1,
    });
  }
  return rows;
}

function scoresFrame(room: MpRoom): Record<string, unknown> {
  let answeredCount = 0;
  for (const p of room.players.values()) if (p.roundAnswered) answeredCount += 1;
  return {
    type: 'scores',
    scores: buildScores(room),
    answeredCount,
    totalPlayers: room.players.size,
  };
}

/** Sends the scoreboard now in a small room; in a large one, at most once per interval. */
function publishScores(room: MpRoom): void {
  if (room.players.size <= COALESCE_ABOVE_PLAYERS) {
    broadcast(room, scoresFrame(room));
    return;
  }
  if (room.scoresTimer) return;
  room.scoresTimer = setTimeout(() => {
    room.scoresTimer = null;
    if (room.phase === 'playing') broadcast(room, scoresFrame(room));
  }, COALESCE_INTERVAL_MS);
}

function buildRoomSnapshot(room: MpRoom): MpRoomSnapshot {
  const all = [...room.players.values()];
  // A thousand names in every frame is what a lobby of a thousand cannot afford, and only the
  // newest few can fit on a phone anyway. The count is exact.
  const shown = all.length > COALESCE_ABOVE_PLAYERS ? all.slice(-LARGE_ROOM_SNAPSHOT_PLAYERS) : all;
  return {
    code: room.code,
    sourceType: room.source.sourceType,
    sourceId: room.source.sourceId,
    label: room.source.label,
    pictureUrl: room.source.pictureUrl,
    guessMode: room.guessMode,
    gameMode: room.gameMode,
    phase: room.phase,
    hostId: room.hostId,
    currentRound: room.currentRound,
    totalRounds: room.rounds,
    // Same masking as buildScores — the snapshot carries the scoreboard too, so leaving it
    // truthful mid-round would hand back exactly what the scores frame is withholding.
    players: shown.map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      isHost: p.isHost,
      score: room.phase === 'playing' ? p.scoreAtRoundStart : p.score,
      roundAnswered: p.roundAnswered,
      roundCorrect: room.phase === 'playing' ? null : p.roundCorrect,
      roundPoints: p.roundPoints,
      stageIndex: p.stageIndex,
      joinedAt: p.joinedAt,
      connected: p.disconnectedAt === null,
    })),
    hostOnlyAudio: room.hostOnlyAudio,
    hostPlayable: room.hostPlayable,
    isDuel: room.duel != null,
    playerCount: all.length,
    event: room.event
      ? {
          id: room.event.id,
          name: room.event.name,
          description: room.event.description,
          audioMode: room.event.audioMode,
        }
      : null,
    paused: room.paused != null,
  };
}

function broadcastRoomState(room: MpRoom): void {
  if (room.players.size <= COALESCE_ABOVE_PLAYERS) {
    const snapshot = buildRoomSnapshot(room);
    for (const p of room.players.values()) {
      sendTo(p.playerId, { type: 'room_state', room: snapshot });
    }
    if (room.hostId && !room.players.has(room.hostId)) {
      sendTo(room.hostId, { type: 'room_state', room: snapshot });
    }
    return;
  }
  if (room.stateTimer) return;
  // Everyone in a large room already knows who they are from their own join frame.
  room.stateTimer = setTimeout(() => {
    room.stateTimer = null;
    broadcast(room, { type: 'room_state', room: buildRoomSnapshot(room) });
  }, COALESCE_INTERVAL_MS);
}

/**
 * One serialisation, written to every socket.
 *
 * This used to call `sendTo` per player, which stamps a per-player `selfId` into the message and
 * so forces a fresh `JSON.stringify` for each one. With a scoreboard carrying a row per player
 * the payload also grows with the room, making a broadcast O(N^2): measured at 223ms for 1000
 * players and 23.5 *seconds* for 10,000, on the same thread that owes everyone the next round.
 * Scores broadcast on every guess, so a large room wedged itself.
 *
 * `selfId` is not lost. It is only read once, to learn which player you are, and it still rides
 * every message sent through `sendTo` — which is how joins and errors go out.
 *
 * See scripts/bench-broadcast.ts.
 */
function broadcast(room: MpRoom, payload: Record<string, unknown>): void {
  let frame: Buffer;
  try {
    // A Buffer, so each socket writes the same bytes rather than re-encoding the string.
    frame = Buffer.from(JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err }, 'Failed to serialise multiplayer broadcast');
    return;
  }
  const write = (id: string) => {
    const socket = sockets.get(id);
    if (!socket) return;
    try {
      socket.send(frame);
    } catch (err) {
      logger.warn({ err }, 'Failed to send multiplayer message');
    }
  };
  for (const p of room.players.values()) write(p.playerId);
  // The host of an event usually holds no seat, and still needs to see everything.
  if (room.hostId && !room.players.has(room.hostId)) write(room.hostId);
}

function sendTo(playerId: string, payload: Record<string, unknown>): void {
  const socket = sockets.get(playerId);
  if (!socket) return;
  try {
    socket.send(JSON.stringify({ selfId: playerId, ...payload }));
  } catch (err) {
    logger.warn({ err }, 'Failed to send multiplayer message');
  }
}

function sendError(playerId: string, message: string): void {
  sendTo(playerId, { type: 'error', message });
}

/**
 * Socket access for the duel matchmaker, which needs to talk to players who are connected but
 * not in any room yet. Exported rather than duplicating the connection registry: two maps of
 * live sockets would drift the first time a disconnect was handled in only one of them.
 */
export function sendToPlayer(playerId: string, payload: Record<string, unknown>): void {
  sendTo(playerId, payload);
}

export function identityFor(playerId: string): Identity | null {
  return identities.get(playerId) ?? null;
}

function roomFor(playerId: string): MpRoom | null {
  const code = playerRooms.get(playerId);
  return code ? (rooms.get(code) ?? null) : null;
}

function clearRoomTimers(room: MpRoom): void {
  for (const t of room.timers) clearTimeout(t);
  room.timers = [];
}

function destroyRoom(room: MpRoom): void {
  clearRoomTimers(room);
  if (room.scoresTimer) clearTimeout(room.scoresTimer);
  if (room.stateTimer) clearTimeout(room.stateTimer);
  for (const p of room.players.values()) playerRooms.delete(p.playerId);
  rooms.delete(room.code);
  logger.info({ code: room.code }, 'Multiplayer room destroyed');
}

// --- Cleanup + test hooks -----------------------------------------------------------------

let gcInterval: ReturnType<typeof setInterval> | null = null;

/** Periodically drops rooms that were created but never joined. */
function ensureGc(): void {
  if (gcInterval) return;
  gcInterval = setInterval(() => sweepEmptyRooms(), 60_000);
  if (typeof gcInterval.unref === 'function') gcInterval.unref();
}

export function sweepEmptyRooms(): void {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.event) {
      sweepEventRoom(room, now);
      continue;
    }
    if (room.players.size === 0 && now - room.createdAt > MP_EMPTY_ROOM_TTL_MS) {
      destroyRoom(room);
    }
  }
}

/** Gives up seats nobody came back to, and takes a deserted event's room out of memory. */
function sweepEventRoom(room: MpRoom, now: number): void {
  let dropped = false;
  if (room.phase === 'lobby') {
    for (const p of room.players.values()) {
      if (p.disconnectedAt !== null && now - p.disconnectedAt > LOBBY_SEAT_GRACE_MS) {
        room.players.delete(p.playerId);
        room.seats.delete(p.seatKey);
        dropped = true;
      }
    }
  }
  if (dropped) broadcastRoomState(room);
  const anyoneHere =
    room.hostId || [...room.players.values()].some((p) => p.disconnectedAt === null);
  if (anyoneHere) room.lastActiveAt = now;
  // A live round's timers keep it going only until they run out of players to serve.
  else if (now - room.lastActiveAt > EVENT_IDLE_ROOM_TTL_MS) destroyRoom(room);
}

/** Closes a stored event's room, if it has one, and tells everyone in it why. */
export function closeEventRoom(eventId: string, reason: string): void {
  for (const room of rooms.values()) {
    if (room.event?.id !== eventId) continue;
    broadcast(room, { type: 'room_closed', reason });
    const ids = [...room.players.keys()];
    if (room.hostId && !room.players.has(room.hostId)) ids.push(room.hostId);
    for (const id of ids) {
      playerRooms.delete(id);
      try {
        sockets.get(id)?.close(4003, 'Event closed');
      } catch {
        /* already gone */
      }
    }
    destroyRoom(room);
  }
}

/** Test hook: re-enables Classic so its (still-live) branches stay covered. See isClassicEnabled. */
export function __setClassicEnabled(enabled: boolean): void {
  classicEnabled = enabled;
}

/** Test hook: clears all in-memory state so tests start from a clean slate. */
export function __resetForTests(): void {
  for (const room of rooms.values()) {
    clearRoomTimers(room);
  }
  rooms.clear();
  sockets.clear();
  identities.clear();
  playerRooms.clear();
  passwordAttempts.clear();
  roomLoads.clear();
  if (gcInterval) {
    clearInterval(gcInterval);
    gcInterval = null;
  }
}

/** How many rooms exist right now, for the admin dashboard. Rooms are in memory only, so this
 *  is the only way to see them. */
export function activeRoomCount(): { total: number; playing: number } {
  let playing = 0;
  for (const room of rooms.values()) {
    if (room.phase === 'playing' || room.phase === 'round-reveal') playing += 1;
  }
  return { total: rooms.size, playing };
}

/**
 * How many people are in a room racing each source, keyed the same way as the duel queue
 * (`artist:<id>` / `category:<slug>`).
 *
 * Lets the pickers show where the activity actually is. A category list is otherwise a wall of
 * equally-plausible options, and picking one is a guess about whether anyone else is there.
 * Counts players rather than rooms: three rooms of one is not a busy category.
 */
export function playersBySource(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const room of rooms.values()) {
    if (room.players.size === 0 || room.event) continue;
    const key = `${room.source.sourceType}:${room.source.sourceId}`;
    counts[key] = (counts[key] ?? 0) + room.players.size;
  }
  return counts;
}

/** All live rooms, for the admin panel. */
export function listRooms(): MpRoomSnapshot[] {
  return [...rooms.values()].map(buildRoomSnapshot);
}

/** Force-close a room from the admin panel. Notifies all players. */
export function forceCloseRoom(code: string): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  if (room.event) {
    eventHooks?.onFinished(room.event.id, room.players.size, []);
    closeEventRoom(room.event.id, 'Closed by an admin.');
    return true;
  }
  broadcast(room, { type: 'room_closed', reason: 'Closed by an admin.' });
  for (const p of room.players.values()) {
    playerRooms.delete(p.playerId);
    try {
      p.socket.close(1000, 'Room closed by admin');
    } catch {
      /* already gone */
    }
  }
  destroyRoom(room);
  return true;
}

export function __getRoom(code: string): MpRoomSnapshot | null {
  const room = rooms.get(code);
  return room ? buildRoomSnapshot(room) : null;
}

export function __getRoomPhase(code: string): MpRoomPhase | null {
  return rooms.get(code)?.phase ?? null;
}

export function __getCurrentTrack(
  code: string,
): { deezerTrackId: string; title: string; artist: string } | null {
  const room = rooms.get(code);
  if (!room) return null;
  const track = room.tracks[room.currentRound];
  return track
    ? { deezerTrackId: track.deezerTrackId, title: track.title, artist: track.artist }
    : null;
}

void ensureGc();

registerMetricSources({
  rooms: () => {
    const events = [...rooms.values()].filter((r) => r.event);
    return {
      rooms: rooms.size,
      connections: sockets.size,
      eventsRunning: events.filter((r) => r.phase === 'playing' || r.phase === 'round-reveal')
        .length,
      playersPerEvent: Object.fromEntries(events.map((r) => [r.code, r.players.size])),
    };
  },
});
