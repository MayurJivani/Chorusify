import type { DailySlotRecap } from '../../types/api';
import { Disc } from './Disc';

interface SlotProgressProps {
  position: number;
  totalSlots: number;
  completedSlots: DailySlotRecap[];
}

/** Today's shelf: finished songs show their cover, the current one is a record, the rest are empty. */
export function SlotProgress({ position, totalSlots, completedSlots }: SlotProgressProps) {
  const byPosition = new Map(completedSlots.map((s) => [s.position, s]));

  return (
    <ol className="flex items-center gap-1.5" aria-label={`Song ${position} of ${totalSlots}`}>
      {Array.from({ length: totalSlots }, (_, i) => {
        const slotPosition = i + 1;
        const done = byPosition.get(slotPosition);
        const isCurrent = !done && slotPosition === position;
        const label = done
          ? `Song ${slotPosition}: ${done.won ? 'correct' : 'wrong'}`
          : isCurrent
            ? `Song ${slotPosition}: in progress`
            : `Song ${slotPosition}: not reached yet`;

        return (
          <li key={slotPosition} title={label} aria-label={label} className="relative h-8 w-8">
            {done ? (
              <>
                {done.song.albumArtUrl ? (
                  <img
                    src={done.song.albumArtUrl}
                    alt=""
                    className="h-full w-full rounded-[3px] object-cover"
                  />
                ) : (
                  <span className="block h-full w-full rounded-[3px] bg-white/10" />
                )}
                <span
                  aria-hidden="true"
                  className={`absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-black ${done.won ? 'bg-chorusify-success' : 'bg-chorusify-danger'}`}
                >
                  {done.won ? '✓' : '✕'}
                </span>
              </>
            ) : isCurrent ? (
              <Disc size="100%" />
            ) : (
              <span className="block h-full w-full rounded-[3px] border border-dashed border-white/15" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
