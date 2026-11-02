import { motion } from 'motion/react';
import { useGameConfig } from '../../hooks/useGameConfig';

interface SnippetProgressBarProps {
  /** 1-based attempt number (search mode) or 0-based skip count (choice mode). */
  stageIndex: number;
}

export function SnippetProgressBar({ stageIndex }: SnippetProgressBarProps) {
  const { snippetSchedule } = useGameConfig();
  const totalStages = snippetSchedule.length;
  const clampedIndex = Math.min(stageIndex, totalStages - 1);
  const widthPercent = totalStages > 1 ? (clampedIndex / (totalStages - 1)) * 100 : 0;

  return (
    <div className="w-full max-w-md">
      {/* Track */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-chorusify-surface/80">
        <motion.div
          className="h-full rounded-full bg-chorusify-accent2"
          initial={{ width: 0 }}
          animate={{ width: `${widthPercent}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      {/* Milestone dots + labels */}
      <div className="mt-2.5 flex justify-between">
        {snippetSchedule.map((seconds, i) => {
          const reached = i <= stageIndex;
          return (
            <div key={seconds} className="flex flex-col items-center gap-1">
              <span
                className={
                  'h-1.5 w-1.5 rounded-full transition-colors duration-300 ' +
                  (reached ? 'bg-chorusify-accent2 shadow-[0_0_4px_#22d3ee99]' : 'bg-slate-700')
                }
              />
              <span
                className={`text-[10px] font-mono transition-colors duration-300 ${reached ? 'text-chorusify-accent2' : 'text-slate-600'}`}
              >
                {seconds}s
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
