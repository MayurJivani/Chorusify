import { apiRequest } from './client';
import type {
  EventInput,
  EventJoinInfo,
  HostedEvent,
  Playlist,
  PlaylistTrack,
  SongHit,
} from '../types/api';

export type SearchField = 'any' | 'artist' | 'album';

export function searchEventSongs(q: string, field: SearchField, signal: AbortSignal) {
  const params = new URLSearchParams({ q, field });
  return apiRequest<{ results: SongHit[] }>(`/events/songs/search?${params}`, {
    signal,
    skipCache: true,
  });
}

export const listPlaylists = () =>
  apiRequest<{ playlists: Playlist[] }>('/events/playlists', { skipCache: true });

export const savePlaylist = (id: string | null, name: string, tracks: PlaylistTrack[]) =>
  apiRequest<{ playlist: Playlist }>(id ? `/events/playlists/${id}` : '/events/playlists', {
    method: id ? 'PATCH' : 'POST',
    body: { name, tracks },
  });

export const deletePlaylist = (id: string) =>
  apiRequest<{ ok: true }>(`/events/playlists/${id}`, { method: 'DELETE' });

export const listMyEvents = () =>
  apiRequest<{ events: HostedEvent[] }>('/events/mine', { skipCache: true });

export const getHostedEvent = (id: string) =>
  apiRequest<{ event: HostedEvent }>(`/events/${id}`, { skipCache: true });

export const saveEvent = (id: string | null, input: EventInput) =>
  apiRequest<{ event: HostedEvent }>(id ? `/events/${id}` : '/events', {
    method: id ? 'PATCH' : 'POST',
    body: input,
  });

export const deleteEvent = (id: string) =>
  apiRequest<{ ok: true }>(`/events/${id}`, { method: 'DELETE' });

export const getEventJoinInfo = (code: string) =>
  apiRequest<{ event: EventJoinInfo | null }>(`/events/join/${encodeURIComponent(code)}`);

export const listPublicEvents = () =>
  apiRequest<{
    events: { code: string; name: string; description: string; needsPassword: boolean; status: string }[];
  }>('/events/public');
