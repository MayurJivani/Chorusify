import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGameState } from './useGameState';
import { submitGuess } from '../../api/puzzle';

vi.mock('../../hooks/useGameConfig', () => ({
  useGameConfig: () => ({ snippetSchedule: [2, 4, 8, 12, 16], maxGuesses: 5 }),
}));
vi.mock('../../api/stats', () => ({ getMyStats: vi.fn() }));
vi.mock('../../api/puzzle', () => ({
  getTodaysPuzzle: vi.fn().mockResolvedValue({
    completed: false,
    totalSlots: 3,
    position: 1,
    completedSlots: [],
    previewUrl: 'x',
  }),
  submitGuess: vi.fn().mockResolvedValue({
    correct: false,
    isFinal: true,
    position: 1,
    song: { title: 'T', artist: 'A' },
  }),
}));

/**
 * The daily had no way past a song except pressing Hear more once per attempt, each one a request,
 * and players spamming it hit the rate limit. Skip song must be one request at the last attempt,
 * which the server treats as final.
 */
describe('skipping a daily song', () => {
  it('ends the song in a single request at the last attempt', async () => {
    const { result } = renderHook(() => useGameState());
    await waitFor(() => expect(result.current.status).toBe('playing'));

    await act(async () => {
      await result.current.skipSong();
    });

    expect(submitGuess).toHaveBeenCalledTimes(1);
    expect(submitGuess).toHaveBeenCalledWith({ songId: undefined, guessNumber: 5 });
    expect(result.current.status).toBe('revealing');
  });
});
