import { apiRequest } from './client';
import type { GuessResult, PuzzleResponse } from '../types/api';

export type DailyEdition = 'english' | 'desi';

export function getTodaysPuzzle(edition: DailyEdition = 'english'): Promise<PuzzleResponse> {
  return apiRequest<PuzzleResponse>(`/puzzle/today?edition=${edition}`);
}

export function submitGuess(input: {
  songId?: number;
  guessNumber: number;
  edition?: DailyEdition;
}): Promise<GuessResult> {
  return apiRequest<GuessResult>('/puzzle/today/guess', { method: 'POST', body: input });
}
