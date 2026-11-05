import { apiRequest } from './client';
import type {
  MultiplayerCreateRoomResponse,
  MultiplayerGameMode,
  MultiplayerGuessMode,
} from '../types/api';

/** Ceiling on a host-chosen game length; mirrors MP_MAX_ROUNDS on the server. */
export const MULTIPLAYER_MAX_ROUNDS = 25;

export function createMultiplayerRoom(
  source: { artistId: number } | { categoryId: string },
  guessMode: MultiplayerGuessMode = 'search',
  gameMode: MultiplayerGameMode = 'classic',
  hostOnlyAudio: boolean = false,
  hostPlayable: boolean = true,
  rounds?: number,
  showCovers = false,
): Promise<MultiplayerCreateRoomResponse> {
  return apiRequest<MultiplayerCreateRoomResponse>('/multiplayer/rooms', {
    method: 'POST',
    body: {
      ...source,
      guessMode,
      gameMode,
      hostOnlyAudio,
      hostPlayable,
      showCovers,
      ...(rounds != null ? { rounds } : {}),
    },
  });
}

/** Builds the WebSocket endpoint from the API base URL (http://… -> ws://…). */
export function multiplayerSocketUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8888/api';
  const base = apiUrl.replace(/^http/, 'ws').replace(/\/api\/?$/, '');
  return `${base}/ws`;
}
