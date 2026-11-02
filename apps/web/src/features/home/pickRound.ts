import type { SamplerSong } from '../../api/songs';

/** Song `index` as the answer, with three others from the same edition, in a stable order. */
export function pickRound(songs: SamplerSong[], index: number) {
  if (songs.length === 0) return null;
  const answer = songs[index % songs.length]!;
  const others = songs.filter((s) => s.id !== answer.id && s.dailyEdition === answer.dailyEdition);
  if (others.length < 3) return null;
  const start = index % others.length;
  const decoys = [0, 1, 2].map((n) => others[(start + n) % others.length]!);
  const slot = answer.id % 4;
  const choices = [...decoys.slice(0, slot), answer, ...decoys.slice(slot)];
  return { answer, choices };
}
