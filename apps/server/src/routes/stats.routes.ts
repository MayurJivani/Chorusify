import { Router } from 'express';
import { getStats, getSolveTimeStats } from '../services/statsService';
import { getProgress } from '../services/progressService';
import { evaluateAchievements, sortAchievements } from '../services/achievementsService';
import { getIdentity } from '../auth/identity';
import { asyncHandler } from '../middleware/asyncHandler';

export const statsRouter = Router();

statsRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const ownerKey = req.session.userId ?? req.session.guestId;
    const [stats, solveTimes] = await Promise.all([
      getStats(ownerKey),
      getSolveTimeStats(ownerKey),
    ]);

    if (!stats) {
      res.json({
        currentStreak: 0,
        maxStreak: 0,
        gamesPlayed: 0,
        gamesWon: 0,
        perfectDays: 0,
        guessDistribution: [0, 0, 0, 0, 0, 0],
        lastPlayedDate: null,
        ...solveTimes,
      });
      return;
    }

    res.json({
      currentStreak: stats.currentStreak,
      maxStreak: stats.maxStreak,
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
      perfectDays: stats.perfectDays,
      guessDistribution: [
        stats.guessDist1,
        stats.guessDist2,
        stats.guessDist3,
        stats.guessDist4,
        stats.guessDist5,
        stats.guessDist6,
      ],
      lastPlayedDate: stats.lastPlayedDate,
      ...solveTimes,
    });
  }),
);

/**
 * Level, XP, mastery and achievements, all derived from the runs already recorded.
 *
 * One call rather than two: the achievements are computed from the same progress snapshot, so
 * splitting them would mean building it twice.
 */
statsRouter.get(
  '/progress',
  asyncHandler(async (req, res) => {
    const progress = await getProgress(getIdentity(req));
    res.json({ ...progress, achievements: sortAchievements(evaluateAchievements(progress)) });
  }),
);
