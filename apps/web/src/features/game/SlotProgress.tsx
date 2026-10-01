import type { DailySlotRecap } from '../../types/api';

interface SlotProgressProps {
  position: number;
  totalSlots: number;
  completedSlots: DailySlotRecap[];
}

/** Today's five songs, one dot each: green for correct, red for wrong, hollow for not reached
 *  yet, filled-neutral for the one in progress. Mirrors AttemptPips' dot language one level up. */
export function SlotProgress({ position, totalSlots, completedSlots }: SlotProgressProps) {
  const resultByPosition = new Map(completedSlots.map((s) => [s.position, s.won]));

  return (
    <div className="flex gap-2" aria-label={`Song ${position} of ${totalSlots}`}>
      {Array.from({ length: totalSlots }, (_, i) => {
        const slotPosition = i + 1;
        const won = resultByPosition.get(slotPosition);
        const isCurrent = slotPosition === position;

        const label =
          won === undefined
            ? isCurrent
              ? `Song ${slotPosition}: in progress`
              : `Song ${slotPosition}: not reached yet`
            : `Song ${slotPosition}: ${won ? 'correct' : 'wrong'}`;

        return (
          <span
            key={slotPosition}
            title={label}
            aria-label={label}
            className={
              'h-2.5 w-2.5 rounded-full border-2 transition-all duration-300 ' +
              (won === true
                ? 'border-chorusify-success bg-chorusify-success'
                : won === false
                  ? 'border-chorusify-danger bg-chorusify-danger'
                  : isCurrent
                    ? 'border-chorusify-accent bg-chorusify-accent/40'
                    : 'border-slate-700 bg-transparent')
            }
          />
        );
      })}
    </div>
  );
}
