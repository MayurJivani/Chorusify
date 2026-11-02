import { useEffect, useState } from 'react';
import { getSampler, getSongPreview, type SamplerSong } from '../../api/songs';
import { SnippetPlayer } from '../game/SnippetPlayer';
import { pickRound } from './pickRound';

const SLICES = [1, 2, 4];

/** A free round: not scored, not saved. Audio loads only after someone asks to play. */
export function QuickRound({ songs }: { songs: SamplerSong[] }) {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [slice, setSlice] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const round = pickRound(songs, index);
  const answerId = round?.answer.id;

  useEffect(() => {
    if (!started || !answerId) return;
    let live = true;
    setPreviewUrl(null);
    setSlice(0);
    setPicked(null);
    getSongPreview(answerId)
      .then((r) => live && setPreviewUrl(r.previewUrl))
      // Some tracks lose their preview. Move on rather than show a player that can't play.
      .catch(() => live && setIndex((i) => i + 1));
    return () => {
      live = false;
    };
  }, [started, answerId]);

  if (!round) return null;
  if (!started) {
    return (
      <button type="button" onClick={() => setStarted(true)} className="btn-secondary mx-auto">
        Try a free round
      </button>
    );
  }

  const revealed = picked !== null;
  return (
    <section
      aria-label="Free round"
      className="glass mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-2xl p-4"
    >
      {previewUrl && (
        <SnippetPlayer
          previewUrl={previewUrl}
          stageSeconds={SLICES[slice] ?? 4}
          artistPictureUrl={revealed ? round.answer.albumArtUrl : null}
          playSignal={slice}
        />
      )}
      <ul className="flex w-full flex-col gap-1.5">
        {round.choices.map((song) => (
          <li key={song.id}>
            <button
              type="button"
              disabled={revealed}
              onClick={() => setPicked(song.id)}
              className={
                'w-full truncate rounded-xl border px-3 py-2 text-left text-sm transition-colors ' +
                (revealed && song.id === answerId
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                  : revealed && song.id === picked
                    ? 'border-red-500/50 bg-red-500/10 text-slate-200'
                    : 'border-white/10 text-slate-200 hover:border-white/30 disabled:opacity-60')
              }
            >
              {song.title} <span className="text-slate-500">· {song.artist}</span>
            </button>
          </li>
        ))}
      </ul>
      {revealed ? (
        <button
          type="button"
          className="btn-primary w-full !py-2"
          onClick={() => setIndex((i) => i + 1)}
        >
          Next song
        </button>
      ) : (
        slice < SLICES.length - 1 && (
          <button
            type="button"
            className="btn-ghost w-full !py-2 !text-sm"
            onClick={() => setSlice((s) => s + 1)}
          >
            Hear {SLICES[slice + 1]}s
          </button>
        )
      )}
    </section>
  );
}

export function useSampler() {
  const [songs, setSongs] = useState<SamplerSong[]>([]);
  useEffect(() => {
    getSampler()
      .then((r) => setSongs(r.songs))
      .catch(() => setSongs([]));
  }, []);
  return songs;
}
