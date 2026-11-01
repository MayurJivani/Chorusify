import { useSyncExternalStore } from 'react';
import type { MultiplayerScoreEntry } from '../../types/api';

export interface ScoresState {
  rows: MultiplayerScoreEntry[];
  answeredCount: number | null;
  totalPlayers: number | null;
}

/**
 * The scoreboard lives outside React state. In a large room it changes several times a second, and
 * as state on the page it re-rendered everything down to the audio player each time. Components
 * subscribe to the slice they read, and only re-render when that slice changes.
 */
export function createScoresStore() {
  let state: ScoresState = { rows: [], answeredCount: null, totalPlayers: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<ScoresState>) {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ScoresStore = ReturnType<typeof createScoresStore>;

/** The selector must return a primitive or a stable reference. */
export function useScores<T>(store: ScoresStore, select: (state: ScoresState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
