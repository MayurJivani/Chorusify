/**
 * Runtime-tunable game settings.
 *
 * Things like "how many songs in a run" and "how long a multiplayer round lasts" used to be
 * compiled-in constants, so changing one meant a code edit and a deploy. They live here instead:
 * one registry describing every setting — its type, its bounds, its default and how to explain
 * it — which drives validation on the server *and* the controls on the admin dashboard, so the
 * two can't drift apart.
 *
 * Defaults are the source of truth. A setting with no row is at its default, and a stored value
 * that no longer validates (bounds tightened, say) falls back to the default for that key alone
 * rather than taking the whole config down with it.
 */
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { logger } from '../logger';

export type SettingGroup = 'challenge' | 'multiplayer' | 'daily' | 'housekeeping';

interface SettingDef<T> {
  group: SettingGroup;
  label: string;
  help: string;
  schema: z.ZodType<T>;
  default: T;
  /** Rendering hint for the dashboard; validation is always the schema's job. */
  control:
    | { kind: 'number'; min: number; max: number; unit?: string }
    | { kind: 'boolean' }
    | {
        kind: 'numberList';
        minLength: number;
        maxLength: number;
        min: number;
        max: number;
        unit?: string;
      };
}

const positiveInt = (min: number, max: number) => z.number().int().min(min).max(max);

/**
 * Every tunable setting.
 *
 * Adding one is a single entry here plus the read at its point of use — the admin API, the
 * dashboard control, validation and the reset-to-default button all come from this object.
 */
export const SETTING_DEFS = {
  challengeRounds: {
    group: 'challenge',
    label: 'Songs per run',
    help: 'How many songs an Artist or Category challenge asks for. Existing challenges keep the length they were built with.',
    schema: positiveInt(3, 30),
    default: 10,
    control: { kind: 'number', min: 3, max: 30, unit: 'songs' },
  } satisfies SettingDef<number>,

  snippetScheduleSeconds: {
    group: 'challenge',
    label: 'Snippet schedule',
    help: 'Seconds of audio revealed at each guess. The number of entries is also the number of guesses a player gets, everywhere in the game.',
    schema: z
      .array(positiveInt(1, 60))
      .min(2)
      .max(10)
      .refine(
        (stages) => stages.every((seconds, i) => i === 0 || seconds > stages[i - 1]!),
        'Each stage must reveal more audio than the one before it',
      ),
    default: [1, 2, 4, 7, 11, 16],
    control: { kind: 'numberList', minLength: 2, maxLength: 10, min: 1, max: 60, unit: 's' },
  } satisfies SettingDef<number[]>,

  multiplayerRounds: {
    group: 'multiplayer',
    label: 'Rounds per game',
    help: 'Songs in a multiplayer game. Rooms already in progress keep their original length.',
    schema: positiveInt(3, 30),
    default: 10,
    control: { kind: 'number', min: 3, max: 30, unit: 'rounds' },
  } satisfies SettingDef<number>,

  multiplayerRoundSeconds: {
    group: 'multiplayer',
    label: 'Round time limit',
    help: 'How long a round can run before it ends on its own. It still ends early once everyone has answered.',
    schema: positiveInt(5, 180),
    default: 30,
    control: { kind: 'number', min: 5, max: 180, unit: 's' },
  } satisfies SettingDef<number>,

  multiplayerRevealSeconds: {
    group: 'multiplayer',
    label: 'Answer reveal time',
    help: 'How long the answer stays on screen between rounds.',
    schema: positiveInt(1, 30),
    default: 10,
    control: { kind: 'number', min: 1, max: 30, unit: 's' },
  } satisfies SettingDef<number>,

  multiplayerMaxPlayers: {
    group: 'multiplayer',
    label: 'Players per room',
    help: 'Upper limit on a room. Eight suits a group of friends; raise it for an audience, where one host plays to a crowd. Rooms already over a lowered limit are not kicked.',
    /*
     * 16 was too low to host an audience at all: the first load test filled at eight and the
     * other 142 clients were told the room was full. It briefly went to 20000, which the
     * broadcast work made survivable — one serialisation per frame, scoreboard capped at ten —
     * but survivable is not the same as playable. A room of thousands is a scoreboard nobody
     * can place themselves on, and everything below still runs in one process on one core.
     * 100 is the size the game was actually tested at end to end.
     */
    schema: positiveInt(2, 100),
    default: 8,
    control: { kind: 'number', min: 2, max: 100, unit: 'players' },
  } satisfies SettingDef<number>,

  /*
   * Join-by-sound (Beta). Off by default: it needs microphone permission on the joining phone
   * and does not work at all on some browsers, so it has to be opted into rather than
   * appearing unannounced in a room full of people.
   */
  soundtrackPopularOnly: {
    group: 'multiplayer',
    label: 'Soundtracks: well-known tracks only',
    help: 'Drop the obscure half of each soundtrack album. A film album is mostly cues and filler nobody has heard, and a round drawn from those is unanswerable rather than hard. Uses Deezer play rank, so it adapts per album instead of a fixed cutoff. Rebuild happens on the next pool refresh.',
    schema: z.boolean(),
    default: false,
    control: { kind: 'boolean' },
  } satisfies SettingDef<boolean>,

  knockJoinEnabled: {
    group: 'multiplayer',
    label: 'Join by sound (Beta)',
    help: 'In Host Only audio rooms, the host screen announces the room code as sound and nearby phones can join without typing it. Needs microphone permission on the joining phone.',
    schema: z.boolean(),
    default: false,
    control: { kind: 'boolean' },
  } satisfies SettingDef<boolean>,

  dailyCuratedOnly: {
    group: 'daily',
    label: 'Curated songs only',
    help: 'Draw the daily puzzle from hand-curated songs only. Turn this off to let chart entries be picked too. They rotate constantly, so a shared song of the day is often one nobody knows.',
    schema: z.boolean(),
    default: true,
    control: { kind: 'boolean' },
  } satisfies SettingDef<boolean>,

  homeWallSongIds: {
    group: 'daily',
    label: 'Home page albums',
    help: 'The songs whose covers fill the home page wall, in order. Empty shows a random selection. Edited on the Home albums tab.',
    schema: z.array(positiveInt(1, 2147483647)).max(60),
    default: [] as number[],
    control: { kind: 'numberList', minLength: 0, maxLength: 60, min: 1, max: 2147483647 },
  } satisfies SettingDef<number[]>,

  artistPoolRetentionDays: {
    group: 'housekeeping',
    label: 'Artist cache retention',
    help: 'Cached artist and category track pools nobody has opened for this long are deleted. Lower keeps the database small; higher saves Deezer calls.',
    schema: positiveInt(1, 365),
    default: 30,
    control: { kind: 'number', min: 1, max: 365, unit: 'days' },
  } satisfies SettingDef<number>,

  categoryPoolRefreshHours: {
    group: 'housekeeping',
    label: 'Category refresh interval',
    help: 'How stale a category playlist may get before it is refreshed in the background. The live worldwide chart is the one that actually moves.',
    schema: positiveInt(1, 720),
    default: 24,
    control: { kind: 'number', min: 1, max: 720, unit: 'hours' },
  } satisfies SettingDef<number>,

  speedRoundDurationSeconds: {
    group: 'multiplayer',
    label: 'Speed round time limit',
    help: 'How long a speed round lasts before it ends on its own.',
    schema: positiveInt(5, 60),
    default: 15,
    control: { kind: 'number', min: 5, max: 60, unit: 's' },
  } satisfies SettingDef<number>,

  speedSnippetSeconds: {
    group: 'multiplayer',
    label: 'Speed snippet length',
    help: 'How many seconds of the preview play in speed mode.',
    schema: positiveInt(5, 30),
    default: 30,
    control: { kind: 'number', min: 5, max: 30, unit: 's' },
  } satisfies SettingDef<number>,

  speedMaxPoints: {
    group: 'multiplayer',
    label: 'Speed scoring - instant answer',
    help: 'Points for a correct answer the moment the round starts. Falls away towards the minimum as the round runs on.',
    schema: positiveInt(10, 500),
    default: 100,
    control: { kind: 'number', min: 10, max: 500, unit: 'pts' },
  } satisfies SettingDef<number>,

  speedMinPoints: {
    group: 'multiplayer',
    label: 'Speed scoring - answer at the buzzer',
    help: 'Points for a correct answer as the round expires. Being right is still worth something.',
    schema: positiveInt(0, 200),
    default: 20,
    control: { kind: 'number', min: 0, max: 200, unit: 'pts' },
  } satisfies SettingDef<number>,

  speedPoints: {
    group: 'multiplayer',
    label: 'Speed scoring - order bonus',
    help: 'Added on top of the time score for being first, second, third to answer correctly. Everyone past the last entry gets that value.',
    schema: z
      .array(positiveInt(0, 100))
      .min(1)
      .max(10)
      .refine(
        (pts) => pts.every((p, i) => i === 0 || p <= pts[i - 1]!),
        'Points must not increase - earlier is better',
      ),
    default: [15, 10, 5],
    control: { kind: 'numberList', minLength: 1, maxLength: 10, min: 0, max: 100, unit: 'pts' },
  } satisfies SettingDef<number[]>,

  abandonedChallengeTtlDays: {
    group: 'housekeeping',
    label: 'Abandoned challenge TTL',
    help: 'Challenges nobody ever played a round of are deleted after this long. Shared links stop working once their challenge is collected.',
    schema: positiveInt(1, 90),
    default: 7,
    control: { kind: 'number', min: 1, max: 90, unit: 'days' },
  } satisfies SettingDef<number>,
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;

export type Settings = {
  [K in SettingKey]: (typeof SETTING_DEFS)[K]['default'];
};

export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

export function defaultSettings(): Settings {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, structuredClone(SETTING_DEFS[key].default)]),
  ) as Settings;
}

/**
 * Settings are read on nearly every request, so they are cached rather than fetched each time.
 * The TTL is short because it only has to cover the gap between a write in one process and the
 * next read in another; a write in *this* process clears the cache immediately.
 */
const CACHE_TTL_MS = 10_000;

let cached: { value: Settings; expiresAt: number } | null = null;

export function invalidateSettingsCache(): void {
  cached = null;
}

async function loadSettings(): Promise<Settings> {
  const settings = defaultSettings();

  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, SETTING_KEYS as string[]));

  for (const row of rows) {
    const def = SETTING_DEFS[row.key as SettingKey];
    if (!def) continue;
    const parsed = def.schema.safeParse(row.value);
    if (parsed.success) {
      (settings as Record<string, unknown>)[row.key] = parsed.data;
    } else {
      // One bad row must not take the rest of the config down, so it is logged and skipped —
      // that key simply stays at its default until someone saves a valid value.
      logger.warn(
        { key: row.key, issues: parsed.error.issues },
        'Stored setting failed validation; using the default',
      );
    }
  }

  return settings;
}

export async function getSettings(): Promise<Settings> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const value = await loadSettings();
    cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (err) {
    // A settings read must never be what breaks a game. Serve the last known values if there
    // are any, otherwise the defaults.
    logger.error({ err }, 'Failed to load settings; falling back');
    return cached?.value ?? defaultSettings();
  }
}

export interface SettingUpdate {
  key: SettingKey;
  value: unknown;
}

/**
 * Validates and stores a batch of settings, then clears the cache. All-or-nothing: if any value
 * is rejected nothing is written, so a partly-applied change can't leave the game in a state
 * the admin didn't ask for.
 */
export async function updateSettings(
  updates: SettingUpdate[],
  updatedBy: string | null,
): Promise<Settings> {
  const validated: { key: SettingKey; value: unknown }[] = [];

  for (const update of updates) {
    const def = SETTING_DEFS[update.key];
    if (!def) throw new SettingsError(`Unknown setting: ${update.key}`);

    const parsed = def.schema.safeParse(update.value);
    if (!parsed.success) {
      throw new SettingsError(
        `${def.label}: ${parsed.error.issues[0]?.message ?? 'invalid value'}`,
      );
    }
    validated.push({ key: update.key, value: parsed.data });
  }

  // In a transaction so the all-or-nothing promise above holds for a mid-write database error
  // too, not just for a rejected value.
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const { key, value } of validated) {
      await tx
        .insert(appSettings)
        .values({ key, value, updatedAt: now, updatedBy })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedAt: now, updatedBy },
        });
    }
  });

  invalidateSettingsCache();
  return getSettings();
}

/** Drops the stored row, which returns the key to its compiled-in default. */
export async function resetSetting(key: SettingKey): Promise<Settings> {
  if (!SETTING_DEFS[key]) throw new SettingsError(`Unknown setting: ${key}`);
  await db.delete(appSettings).where(eq(appSettings.key, key));
  invalidateSettingsCache();
  return getSettings();
}

export class SettingsError extends Error {}

export interface SettingDescriptor {
  key: SettingKey;
  group: SettingGroup;
  label: string;
  help: string;
  value: unknown;
  default: unknown;
  isDefault: boolean;
  control: SettingDef<unknown>['control'];
}

/** Everything the dashboard needs to render the controls, values included. */
export async function describeSettings(): Promise<SettingDescriptor[]> {
  const current = await getSettings();

  return SETTING_KEYS.map((key) => {
    const def = SETTING_DEFS[key];
    const value = current[key];
    return {
      key,
      group: def.group,
      label: def.label,
      help: def.help,
      value,
      default: def.default,
      isDefault: JSON.stringify(value) === JSON.stringify(def.default),
      control: def.control as SettingDef<unknown>['control'],
    };
  });
}

/**
 * The player-facing subset, served publicly so the client renders the right number of guess
 * pips and snippet stages without every component hard-coding them.
 */
export interface PublicGameConfig {
  snippetSchedule: number[];
  maxGuesses: number;
  challengeRounds: number;
  /** Join-by-sound, Beta. Both the broadcasting host and the listening phone read this. */
  knockJoinEnabled: boolean;
  soundtrackPopularOnly: boolean;
}

export async function getPublicGameConfig(): Promise<PublicGameConfig> {
  const settings = await getSettings();
  return {
    snippetSchedule: settings.snippetScheduleSeconds,
    maxGuesses: settings.snippetScheduleSeconds.length,
    challengeRounds: settings.challengeRounds,
    knockJoinEnabled: settings.knockJoinEnabled,
    soundtrackPopularOnly: settings.soundtrackPopularOnly,
  };
}
