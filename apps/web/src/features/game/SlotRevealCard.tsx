import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlbumSleeve } from './AlbumSleeve';
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
  // Starts tucked in, then slides, so the sleeve opening is something you see happen.
  const [showDisc, setShowDisc] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShowDisc(true), 250);
    return () => clearTimeout(timer);
  }, []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="glass relative isolate flex w-full max-w-md flex-col items-center gap-5 overflow-hidden rounded-2xl p-6 text-center"
    >
      {/* The card takes on the colour of the record that just played. */}
      {song.albumArtUrl && (
        <img src={song.albumArtUrl} alt="" aria-hidden="true" className="reveal-glow" />
      )}
      <h2
        className={`text-2xl font-extrabold ${slot.won ? 'gradient-text' : 'text-chorusify-danger'}`}
      >
        {slot.won ? '🎉 Correct!' : '😔 Not quite'}
      </h2>
      <p className="text-xs text-slate-500">
        Song {slot.position} of {totalSlots}
      </p>

      {song.albumArtUrl && (
        <img src={song.albumArtUrl} alt="" aria-hidden="true" className="reveal-glow" />
      )}
      {/* The record slides out of its sleeve as the answer lands. */}
      <motion.div
        className="w-44 sm:w-52"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 170, damping: 20 }}
      >
        <AlbumSleeve cover={song.albumArtUrl} out={showDisc} />
      </motion.div>
      <div>
        <p className="text-lg font-bold leading-snug text-slate-100">{song.title}</p>
        <p className="text-sm text-slate-300">{song.artist}</p>
      </div>

      {slot.previewUrl && <SongPreviewButton previewUrl={slot.previewUrl} />}

      <button type="button" onClick={onContinue} className="btn-primary w-full !rounded-xl">
        {isLastSlot ? 'See today’s results' : 'Next song'}
      </button>
    </motion.div>
  );
}
