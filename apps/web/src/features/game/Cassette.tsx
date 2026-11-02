interface CassetteProps {
  playing: boolean;
  progress: number;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}

/** Desi Daily's player. Reels turn only while audio plays, and tape moves between them as it does. */
export function Cassette({ playing, progress, label, disabled, onToggle }: CassetteProps) {
  const reel =
    'h-full aspect-square rounded-full border-4 border-dashed border-slate-300 animate-[spin_2.4s_linear_infinite] motion-reduce:animate-none';
  const state = { animationPlayState: playing ? 'running' : 'paused' };
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={playing ? 'Stop the snippet' : 'Play the snippet'}
      className="relative block aspect-[1.58] w-52 rounded-xl border border-white/15 bg-chorusify-surface-2 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.6)] transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:w-72"
    >
      <span className="block truncate rounded-t bg-chorusify-accent px-2 py-1 text-left text-xs font-bold text-white sm:text-sm">
        {label}
      </span>
      <span className="flex h-[58%] items-center justify-between rounded-b bg-neutral-950 px-[14%] py-[5%]">
        <span className={reel} style={{ ...state, scale: 1.1 - progress * 0.3 }} />
        <span className={reel} style={{ ...state, scale: 0.8 + progress * 0.3 }} />
      </span>
    </button>
  );
}
