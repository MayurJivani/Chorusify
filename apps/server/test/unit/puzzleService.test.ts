import { describe, it, expect, beforeEach } from 'vitest';
import { asc } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { songs, dailyPuzzles, gameResults, userStats } from '../../src/db/schema';
import {
  getOrCreateDailyPuzzles,
  getUtcDateString,
  previewUpcomingPuzzles,
  SNIPPET_SCHEDULE_SECONDS,
  SLOTS_PER_DAY,
} from '../../src/services/puzzleService';

async function seedSong(n: number) {
  const [song] = await db
    .insert(songs)
    .values({
      title: `Song ${n}`,
      artist: `Artist ${n}`,
      deezerTrackId: `track-${n}`,
      previewUrl: `https://example.test/preview-${n}.mp3`,
      durationSeconds: 180,
    })
    .returning();
  return song;
}

beforeEach(async () => {
  // Delete in dependency order: game_results references daily_puzzles, and rows left behind
  // by another test file would otherwise make this cleanup fail on a foreign key.
  await db.delete(gameResults);
  await db.delete(userStats);
  await db.delete(dailyPuzzles);
  await db.delete(songs);
});

describe('getUtcDateString', () => {
  it('formats a date as YYYY-MM-DD in UTC', () => {
    const date = new Date('2026-03-05T23:59:59Z');
    expect(getUtcDateString(date)).toBe('2026-03-05');
  });
});

describe('SNIPPET_SCHEDULE_SECONDS', () => {
  it('has six increasing stages', () => {
    expect(SNIPPET_SCHEDULE_SECONDS).toHaveLength(6);
    for (let i = 1; i < SNIPPET_SCHEDULE_SECONDS.length; i += 1) {
      const current = SNIPPET_SCHEDULE_SECONDS[i]!;
      const previous = SNIPPET_SCHEDULE_SECONDS[i - 1]!;
      expect(current).toBeGreaterThan(previous);
    }
  });
});

function dateAt(offsetDays: number): string {
  const base = new Date('2026-04-01T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return getUtcDateString(base);
}

describe('getOrCreateDailyPuzzles', () => {
  it('throws when there are no active songs', async () => {
    await expect(getOrCreateDailyPuzzles('2026-01-01')).rejects.toThrow();
  });

  it('deterministically returns the same songs for the same date', async () => {
    for (let i = 0; i < 10; i += 1) await seedSong(i);

    const first = await getOrCreateDailyPuzzles('2026-01-01');
    const second = await getOrCreateDailyPuzzles('2026-01-01');

    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id));
    expect(second.map((p) => p.songId)).toEqual(first.map((p) => p.songId));
  });

  it('creates exactly SLOTS_PER_DAY rows per date', async () => {
    for (let i = 0; i < 10; i += 1) await seedSong(i);

    await getOrCreateDailyPuzzles('2026-02-14');
    await getOrCreateDailyPuzzles('2026-02-14');

    const rows = await db.select().from(dailyPuzzles);
    expect(rows).toHaveLength(SLOTS_PER_DAY);
    expect(rows.map((r) => r.position).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("a day's five songs are distinct from each other", async () => {
    for (let i = 0; i < 10; i += 1) await seedSong(i);

    const puzzles = await getOrCreateDailyPuzzles('2026-03-01');

    expect(new Set(puzzles.map((p) => p.songId)).size).toBe(SLOTS_PER_DAY);
  });

  it('fills in missing positions without touching ones that already exist', async () => {
    for (let i = 0; i < 10; i += 1) await seedSong(i);

    const [pinned1, pinned2] = await db.select().from(songs).orderBy(asc(songs.id)).limit(2);
    await db.insert(dailyPuzzles).values([
      { puzzleDate: '2026-03-10', position: 1, songId: pinned1!.id },
      { puzzleDate: '2026-03-10', position: 2, songId: pinned2!.id },
    ]);

    const puzzles = await getOrCreateDailyPuzzles('2026-03-10');

    expect(puzzles).toHaveLength(SLOTS_PER_DAY);
    expect(puzzles[0]?.songId).toBe(pinned1!.id);
    expect(puzzles[1]?.songId).toBe(pinned2!.id);
    expect(puzzles.map((p) => p.position)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never repeats a song until every other active song has had a turn', async () => {
    const dayCount = 3;
    const songCount = dayCount * SLOTS_PER_DAY;
    for (let i = 0; i < songCount; i += 1) await seedSong(i);

    const usedSongIds: number[] = [];
    for (let day = 0; day < dayCount; day += 1) {
      const puzzles = await getOrCreateDailyPuzzles(dateAt(day));
      usedSongIds.push(...puzzles.map((p) => p.songId));
    }

    // A full cycle of `songCount` slots must use every active song exactly once.
    expect(new Set(usedSongIds).size).toBe(songCount);
  });

  it('allows repeats again once a full cycle has completed', async () => {
    const dayCount = 2;
    const songCount = dayCount * SLOTS_PER_DAY;
    for (let i = 0; i < songCount; i += 1) await seedSong(i);

    const cycleIds = new Set<number>();
    for (let day = 0; day < dayCount; day += 1) {
      const puzzles = await getOrCreateDailyPuzzles(dateAt(day));
      puzzles.forEach((p) => cycleIds.add(p.songId));
    }

    // The next day must not throw even though the whole pool was just used, and it can only
    // draw from songs that exist.
    const next = await getOrCreateDailyPuzzles(dateAt(dayCount));
    expect(next).toHaveLength(SLOTS_PER_DAY);
    for (const puzzle of next) expect(cycleIds.has(puzzle.songId)).toBe(true);
  });
});

describe('previewUpcomingPuzzles', () => {
  async function seedCurated(count: number) {
    await db.insert(songs).values(
      Array.from({ length: count }, (_, i) => ({
        title: `Song ${i + 1}`,
        artist: 'Tester',
        deezerTrackId: `prev-${i}`,
        previewUrl: 'https://example.test/p.mp3',
        durationSeconds: 200,
        active: true,
        manualOverride: true,
      })),
    );
  }

  it('projects a run of days without creating any of them', async () => {
    await seedCurated(5 * SLOTS_PER_DAY);

    const upcoming = await previewUpcomingPuzzles(5);

    expect(upcoming).toHaveLength(5 * SLOTS_PER_DAY);
    expect(upcoming.every((s) => !s.scheduled)).toBe(true);
    // The whole point: previewing must not pin anything.
    expect(await db.select().from(dailyPuzzles)).toEqual([]);
  });

  it('starts at today and walks forward one day at a time', async () => {
    await seedCurated(3 * SLOTS_PER_DAY);
    const upcoming = await previewUpcomingPuzzles(3);
    const firstOfEachDay = upcoming.filter((s) => s.position === 1);

    expect(firstOfEachDay[0]?.puzzleDate).toBe(getUtcDateString());
    const dayMs = 24 * 60 * 60 * 1000;
    const first = new Date(`${firstOfEachDay[0]!.puzzleDate}T00:00:00Z`).getTime();
    expect(new Date(`${firstOfEachDay[1]!.puzzleDate}T00:00:00Z`).getTime()).toBe(first + dayMs);
    expect(new Date(`${firstOfEachDay[2]!.puzzleDate}T00:00:00Z`).getTime()).toBe(
      first + 2 * dayMs,
    );
  });

  it("a day's own five slots never repeat a song", async () => {
    await seedCurated(5 * SLOTS_PER_DAY);
    const upcoming = await previewUpcomingPuzzles(5);

    for (let day = 0; day < 5; day += 1) {
      const slots = upcoming.slice(day * SLOTS_PER_DAY, (day + 1) * SLOTS_PER_DAY);
      expect(new Set(slots.map((s) => s.songId)).size).toBe(SLOTS_PER_DAY);
    }
  });

  /**
   * The reason the projection has to be sequential. Each slot excludes recently used songs, so
   * a later slot's answer depends on what earlier slots took — asking each in isolation would
   * happily project the same song twice running.
   */
  it('does not repeat a song while the pool is exactly large enough', async () => {
    const dayCount = 5;
    await seedCurated(dayCount * SLOTS_PER_DAY);
    const upcoming = await previewUpcomingPuzzles(dayCount);

    const ids = upcoming.map((s) => s.songId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('agrees with what the picker actually chooses', async () => {
    await seedCurated(2 * SLOTS_PER_DAY);
    const projected = await previewUpcomingPuzzles(1);

    const created = await getOrCreateDailyPuzzles(getUtcDateString());

    expect(projected.map((s) => s.songId)).toEqual(created.map((p) => p.songId));
  });

  it('reports an already-created day as settled, not projected', async () => {
    await seedCurated(2 * SLOTS_PER_DAY);
    await getOrCreateDailyPuzzles(getUtcDateString());

    const today = await previewUpcomingPuzzles(1);
    expect(today.every((s) => s.scheduled)).toBe(true);
  });

  it('re-threads later days around a pinned one', async () => {
    await seedCurated(3 * SLOTS_PER_DAY);
    const before = await previewUpcomingPuzzles(3);
    const beforeFirstOfDay = before.filter((s) => s.position === 1);

    // Pin tomorrow's first song to whatever the day after was going to take.
    const dayMs = 24 * 60 * 60 * 1000;
    const tomorrow = getUtcDateString(new Date(Date.now() + dayMs));
    await db.insert(dailyPuzzles).values({
      puzzleDate: tomorrow,
      position: 1,
      songId: beforeFirstOfDay[2]!.songId!,
    });

    const after = await previewUpcomingPuzzles(3);
    const afterFirstOfDay = after.filter((s) => s.position === 1);

    expect(afterFirstOfDay[1]?.scheduled).toBe(true);
    expect(afterFirstOfDay[1]?.songId).toBe(beforeFirstOfDay[2]?.songId);
    // The day after can no longer take the song that just got pinned ahead of it.
    expect(afterFirstOfDay[2]?.songId).not.toBe(beforeFirstOfDay[2]?.songId);
  });

  it('returns nothing playable when the bank is empty', async () => {
    const upcoming = await previewUpcomingPuzzles(2);
    expect(upcoming.every((s) => s.songId === null)).toBe(true);
  });
});
