import { useEffect, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { Link } from 'react-router-dom';
import confetti from 'canvas-confetti';
import type { DailySlotRecap } from '../../types/api';
import { buildRunShareText } from '../stats/shareText';
import { renderResultCard, shareResultCard } from '../stats/resultCard';

interface WinLoseOverlayProps {
  slots: DailySlotRecap[];
  correctCount: number;
  totalSlots: number;
  puzzleDate: string;
  streak: { current: number; max: number };
  edition?: 'english' | 'desi';
}

export function WinLoseOverlay({
  slots,
  correctCount,
  totalSlots,
  puzzleDate,
  streak,
  edition = 'english',
}: WinLoseOverlayProps) {
  const [copied, setCopied] = useState(false);
  const perfectDay = correctCount === totalSlots;
  const name = edition === 'desi' ? 'Desi Daily' : 'Daily';
  const other =
    edition === 'desi'
      ? { to: '/play', label: 'Play the Daily too' }
      : { to: '/desi', label: 'Play Desi Daily too' };
  const shown = useMotionValue(0);
  const score = useTransform(shown, (v) => String(Math.round(v)));

  useEffect(() => {
    const controls = animate(shown, correctCount, { duration: 0.7, ease: 'easeOut' });
    return () => controls.stop();
  }, [shown, correctCount]);

  useEffect(() => {
    if (perfectDay) {
      void confetti({
        particleCount: 140,
        spread: 90,
        origin: { y: 0.6 },
        colors: ['#7c5cff', '#22d3ee', '#22c55e'],
      });
    }
  }, [perfectDay]);

  const handleShare = async () => {
    const text =
      buildRunShareText({
        subject: `${name} · ${puzzleDate}`,
        history: slots.map((s) => s.won),
        songsCorrect: correctCount,
        totalRounds: totalSlots,
      }) + `\n🔥 ${streak.current} day streak`;

    const blob = await renderResultCard({
      subject: `${name} ${puzzleDate}`,
      headline: `${correctCount}/${totalSlots}`,
      caption: `🔥 ${streak.current} day streak`,
      history: slots.map((s) => s.won),
      totalRounds: totalSlots,
    });

    if (blob) {
      await shareResultCard(blob, `chorusify-${puzzleDate}.png`, text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // fall through to clipboard
      }
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="glass flex w-full max-w-md flex-col items-center gap-5 rounded-2xl p-6 text-center"
    >
      <h2 className={`text-2xl font-extrabold ${perfectDay ? 'gradient-text' : 'text-slate-100'}`}>
        {perfectDay ? (
          '🎉 Perfect day!'
        ) : (
          <>
            <motion.span>{score}</motion.span>/{totalSlots} today
          </>
        )}
      </h2>

      <p className="text-sm text-slate-400">
        🔥 {streak.current} day streak{streak.max > streak.current && ` · best ${streak.max}`}
      </p>

      <ul className="flex w-full flex-col gap-2 text-left">
        {slots.map((slot) => (
          <li
            key={slot.position}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-2"
          >
            {slot.song.albumArtUrl && (
              <img
                src={slot.song.albumArtUrl}
                alt=""
                className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-100">{slot.song.title}</p>
              <p className="truncate text-xs text-slate-400">{slot.song.artist}</p>
            </div>
            <span className={slot.won ? 'text-chorusify-success' : 'text-chorusify-danger'}>
              {slot.won ? '✓' : '✕'}
            </span>
          </li>
        ))}
      </ul>

      <button type="button" onClick={handleShare} className="btn-primary w-full !rounded-xl">
        {copied ? '✓ Copied!' : 'Share result'}
      </button>
      <Link to={other.to} className="btn-secondary w-full !rounded-xl">
        {other.label}
      </Link>
    </motion.div>
  );
}
