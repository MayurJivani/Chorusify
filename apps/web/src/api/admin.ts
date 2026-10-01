import { apiRequest } from './client';
import type {
  AdminDailyPuzzleList,
  AdminActivity,
  AdminDashboard,
  AdminPool,
  AdminPoolTracks,
  AdminRoom,
  AdminSong,
  AdminUser,
  SettingDescriptor,
  UpcomingSchedule,
} from '../types/api';

export function getDailyPuzzles(from?: string): Promise<AdminDailyPuzzleList> {
  return apiRequest<AdminDailyPuzzleList>(
    `/admin/daily-puzzles${from ? `?from=${encodeURIComponent(from)}` : ''}`,
  );
}

export async function searchAdminSongs(q: string): Promise<AdminSong[]> {
  const res = await apiRequest<{ songs: AdminSong[] }>(
    `/admin/songs${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
  );
  return res.songs;
}

export function setDailyPuzzle(
  date: string,
  position: number,
  songId: number,
): Promise<{ ok: true }> {
  return apiRequest(`/admin/daily-puzzles/${date}/${position}`, {
    method: 'PUT',
    body: { songId },
  });
}

export function unscheduleDailyPuzzle(date: string, position: number): Promise<{ ok: true }> {
  return apiRequest(`/admin/daily-puzzles/${date}/${position}`, { method: 'DELETE' });
}

export function updateSongFlags(
  songId: number,
  patch: { active?: boolean; manualOverride?: boolean },
): Promise<{ song: AdminSong }> {
  return apiRequest(`/admin/songs/${songId}`, { method: 'PATCH', body: patch });
}

export async function getAdminSettings(): Promise<SettingDescriptor[]> {
  const res = await apiRequest<{ settings: SettingDescriptor[] }>('/admin/settings');
  return res.settings;
}

/** Saves a batch. The server validates all of them before writing any, so a rejected value
 *  leaves every other edit unapplied too — the whole form succeeds or fails together. */
export async function saveAdminSettings(
  updates: { key: string; value: unknown }[],
): Promise<SettingDescriptor[]> {
  const res = await apiRequest<{ settings: SettingDescriptor[] }>('/admin/settings', {
    method: 'PATCH',
    body: { updates },
  });
  return res.settings;
}

export async function resetAdminSetting(key: string): Promise<SettingDescriptor[]> {
  const res = await apiRequest<{ settings: SettingDescriptor[] }>(`/admin/settings/${key}/reset`, {
    method: 'POST',
  });
  return res.settings;
}

export function getAdminDashboard(): Promise<AdminDashboard> {
  return apiRequest<AdminDashboard>('/admin/dashboard');
}

export function getUpcomingSchedule(days = 14): Promise<UpcomingSchedule> {
  return apiRequest<UpcomingSchedule>(`/admin/daily-puzzles/upcoming?days=${days}`);
}

/** Swaps one slot onto a different random song. Never returns a song already used that day. */
export function randomizeDailyPuzzle(date: string, position: number): Promise<{ ok: true }> {
  return apiRequest(`/admin/daily-puzzles/${date}/${position}/randomize`, { method: 'POST' });
}

// --- Users -------------------------------------------------------------------------------

export async function getAdminUsers(
  q?: string,
  limit = 50,
  offset = 0,
): Promise<{ users: AdminUser[]; total: number }> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return apiRequest(`/admin/users?${params}`);
}

export async function updateAdminUser(
  userId: string,
  patch: { isAdmin?: boolean; displayName?: string },
): Promise<{ user: AdminUser }> {
  return apiRequest(`/admin/users/${userId}`, { method: 'PATCH', body: patch });
}

// --- Multiplayer rooms -------------------------------------------------------------------

export async function getAdminRooms(): Promise<{ rooms: AdminRoom[] }> {
  return apiRequest('/admin/rooms');
}

export async function closeAdminRoom(code: string): Promise<{ ok: true }> {
  return apiRequest(`/admin/rooms/${code}`, { method: 'DELETE' });
}

// --- Category and collection pools -------------------------------------------------------

export async function getAdminPools(): Promise<{ pools: AdminPool[] }> {
  return apiRequest('/admin/pools');
}

export async function getAdminPoolTracks(id: string): Promise<AdminPoolTracks> {
  return apiRequest(`/admin/pools/${encodeURIComponent(id)}`);
}

// --- Activity ----------------------------------------------------------------------------

export async function getAdminActivity(limit = 40): Promise<AdminActivity> {
  return apiRequest(`/admin/activity?limit=${limit}`);
}
