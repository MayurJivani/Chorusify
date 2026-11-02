import { apiRequest } from './client';
import type { SongSearchResult } from '../types/api';

export async function searchSongs(query: string): Promise<SongSearchResult[]> {
  if (!query.trim()) return [];
  const res = await apiRequest<{ results: SongSearchResult[] }>(
    `/songs/search?q=${encodeURIComponent(query)}`,
  );
  return res.results;
}

export interface SamplerSong extends SongSearchResult {
  id: number;
  dailyEdition: 'english' | 'desi';
}

export function getSampler(): Promise<{ songs: SamplerSong[]; total: number }> {
  return apiRequest('/songs/sampler');
}

export function getSongPreview(id: number): Promise<{ previewUrl: string }> {
  return apiRequest(`/songs/${id}/preview`);
}
