import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { db } from '../../src/db/client';
import { resetSetting, updateSettings } from '../../src/services/settingsService';
import { dailyPuzzles, gameResults, songs } from '../../src/db/schema';

const app = createApp();

beforeEach(async () => {
  // Clear the rows that reference songs first — another test file may have left a daily
  // puzzle behind, and its FK would otherwise reject the delete below.
  await db.delete(gameResults);
  await db.delete(dailyPuzzles);
  await db.delete(songs);
  await db.insert(songs).values([
    {
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      deezerTrackId: 'dz-1',
      previewUrl: 'https://example.test/1.mp3',
      durationSeconds: 355,
    },
    {
      title: 'Billie Jean',
      artist: 'Michael Jackson',
      deezerTrackId: 'dz-2',
      previewUrl: 'https://example.test/2.mp3',
      durationSeconds: 294,
    },
    {
      title: 'Bad Romance',
      artist: 'Lady Gaga',
      deezerTrackId: 'dz-3',
      previewUrl: 'https://example.test/3.mp3',
      durationSeconds: 295,
      active: false,
    },
  ]);
});

describe('GET /api/songs/search', () => {
  it('finds songs by a title prefix', async () => {
    const res = await request(app).get('/api/songs/search').query({ q: 'Bohem' });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].title).toBe('Bohemian Rhapsody');
  });

  it('finds songs by artist', async () => {
    const res = await request(app).get('/api/songs/search').query({ q: 'Jackson' });
    expect(res.status).toBe(200);
    expect(res.body.results[0].artist).toBe('Michael Jackson');
  });

  it('excludes inactive songs', async () => {
    const res = await request(app).get('/api/songs/search').query({ q: 'Bad Romance' });
    expect(res.body.results).toHaveLength(0);
  });

  it('does not error on search-special characters in the query', async () => {
    const res = await request(app).get('/api/songs/search').query({ q: '"quote AND OR *' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  it('rejects an empty query', async () => {
    const res = await request(app).get('/api/songs/search').query({ q: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/songs/search — daily answers stay searchable', () => {
  it('returns an inactive song when it is the answer to a daily puzzle', async () => {
    // The chart sync deactivates songs that drop off the chart, including ones already chosen
    // as an answer. When that happened the autocomplete stopped offering the song, so the only
    // guess that could win was the one a player could not type.
    const [song] = await db
      .insert(songs)
      .values({
        title: 'Retired Chart Hit',
        artist: 'Someone',
        deezerTrackId: 'dz-retired',
        previewUrl: 'https://example.test/retired.mp3',
        durationSeconds: 200,
        active: false,
      })
      .returning();

    await db.insert(dailyPuzzles).values({ puzzleDate: '2026-09-09', songId: song!.id });

    const res = await request(app).get('/api/songs/search').query({ q: 'Retired' });

    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { title: string }) => r.title)).toContain('Retired Chart Hit');
  });

  it('still hides an inactive song that was never a puzzle answer', async () => {
    await db.insert(songs).values({
      title: 'Never Chosen',
      artist: 'Someone',
      deezerTrackId: 'dz-never',
      previewUrl: 'https://example.test/never.mp3',
      durationSeconds: 200,
      active: false,
    });

    const res = await request(app).get('/api/songs/search').query({ q: 'Never' });

    expect(res.body.results).toHaveLength(0);
  });
});

describe('GET /api/songs/sampler', () => {
  it('returns the admin picks in their chosen order', async () => {
    const rows = await db
      .insert(songs)
      .values(
        ['a', 'b', 'c'].map((n) => ({
          title: `Wall ${n}`,
          artist: 'Someone',
          deezerTrackId: `wall-${n}`,
          previewUrl: 'https://example.test/p.mp3',
          albumArtUrl: `https://example.test/${n}.jpg`,
          durationSeconds: 200,
        })),
      )
      .returning();
    const picks = [rows[2]!.id, rows[0]!.id];
    await updateSettings([{ key: 'homeWallSongIds', value: picks }], null);
    const res = await request(app).get('/api/songs/sampler');
    await resetSetting('homeWallSongIds');
    expect(res.body.songs.map((s: { id: number }) => s.id)).toEqual(picks);
  });
});

describe('GET /api/songs/:id/preview', () => {
  it('404s for a song that does not exist, and rejects a non-numeric id', async () => {
    expect((await request(app).get('/api/songs/999999/preview')).status).toBe(404);
    expect((await request(app).get('/api/songs/abc/preview')).status).toBe(400);
  });
});
