import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { db } from '../../src/db/client';
import { userStats } from '../../src/db/schema';
import { recordGameResult } from '../../src/services/statsService';

const app = createApp();

beforeEach(async () => {
  await db.delete(userStats);
});

describe('GET /api/stats/me', () => {
  it('returns zeroed stats for an identity with no history', async () => {
    const res = await request(app).get('/api/stats/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      currentStreak: 0,
      maxStreak: 0,
      gamesPlayed: 0,
      gamesWon: 0,
      perfectDays: 0,
      guessDistribution: [0, 0, 0, 0, 0, 0],
      lastPlayedDate: null,
      // Timing aggregates are null rather than 0 for someone with no history — a "0s fastest
      // solve" would read as an achievement rather than an absence.
      averageSolveSeconds: null,
      fastestSolveSeconds: null,
      slowestSolveSeconds: null,
      totalPlaySeconds: 0,
      averageGuessesPerWin: null,
      averageSnippetSeconds: null,
      timedWins: 0,
    });
  });

  it("returns a guest's recorded stats keyed to their session", async () => {
    const agent = request.agent(app);
    const me = await agent.get('/api/auth/me');
    const guestId = me.body.guestId as string;

    await recordGameResult({
      ownerKey: guestId,
      puzzleDate: '2026-01-01',
      slots: [
        { won: true, guessesUsed: 3 },
        { won: false, guessesUsed: 6 },
        { won: false, guessesUsed: 6 },
        { won: false, guessesUsed: 6 },
        { won: false, guessesUsed: 6 },
      ],
    });

    const res = await agent.get('/api/stats/me');
    expect(res.status).toBe(200);
    expect(res.body.currentStreak).toBe(1);
    expect(res.body.gamesPlayed).toBe(1);
    expect(res.body.gamesWon).toBe(1);
    expect(res.body.perfectDays).toBe(0);
    expect(res.body.guessDistribution).toEqual([0, 0, 1, 0, 0, 0]);
  });
});
