import { motion } from 'framer-motion';
import type { RevealedSlot } from './useGameState';
import { SongPreviewButton } from './SongPreviewButton';

interface SlotRevealCardProps {
  slot: RevealedSlot;
  totalSlots: number;
  isLastSlot: boolean;
  onContinue: () => void;
}

/** Shown right after a song is finished, correct or not — the answer plus a way to actually
 *  hear it, before moving on to the next one (or to the day's overall results). */
export function SlotRevealCard({ slot, totalSlots, isLastSlot, onContinue }: SlotRevealCardProps) {
  const { song } = slot;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="glass flex w-full max-w-md flex-col items-center gap-5 rounded-2xl p-6 text-center"
    >
      <h2
        className={`text-2xl font-extrabold ${slot.won ? 'gradient-text' : 'text-chorusify-danger'}`}
      >
        {slot.won ? '🎉 Correct!' : '😔 Not quite'}
      </h2>
      <p className="text-xs text-slate-500">
        Song {slot.position} of {totalSlots}
      </p>

      <div className="flex items-center gap-4">
        {song.albumArtUrl && (
          <img
            src={song.albumArtUrl}
            alt=""
            className={
              'h-20 w-20 flex-shrink-0 rounded-xl object-cover shadow-xl ' +
              (slot.won
                ? 'shadow-chorusify-accent/30 ring-2 ring-chorusify-accent/40'
                : 'shadow-chorusify-danger/20')
            }
          />
        )}
        <div className="text-left">
          <p className="text-lg font-bold text-slate-100 leading-snug">{song.title}</p>
          <p className="text-sm text-slate-400">{song.artist}</p>
        </div>
      </div>

      {slot.previewUrl && <SongPreviewButton previewUrl={slot.previewUrl} />}

      <button type="button" onClick={onContinue} className="btn-primary w-full !rounded-xl">
        {isLastSlot ? 'See today’s results' : 'Next song'}
      </button>
    </motion.div>
  );
}
