import { useRef, useState, type PointerEvent } from 'react';
import { motion } from 'motion/react';

const REST = 2;
// The needle stays on the grooves: the end of the run is short of the label.
const START = 8;
const END = 23;
// Past this the needle is over the record, so letting go drops it.
const DROP = 6;

interface TonearmProps {
  playing: boolean;
  /** How far through the permitted slice the audio really is, 0 to 1. */
  progress: number;
  disabled?: boolean;
  onToggle: () => void;
}

/** Drag onto the record to play, off to stop. A pointer nicety: the record itself stays the control. */
export function Tonearm({ playing, progress, disabled, onToggle }: TonearmProps) {
  const pivot = useRef<HTMLDivElement | null>(null);
  const [dragAngle, setDragAngle] = useState<number | null>(null);

  const angleAt = (e: PointerEvent) => {
    const box = pivot.current?.getBoundingClientRect();
    if (!box) return REST;
    const degrees =
      (Math.atan2(box.left + box.width / 2 - e.clientX, e.clientY - box.top) * 180) / Math.PI;
    return Math.min(END, Math.max(0, degrees));
  };

  return (
    <motion.div
      ref={pivot}
      aria-hidden="true"
      className="absolute z-10 origin-top touch-none"
      style={{ right: '-16%', top: '-6%', width: '14%', height: '78%' }}
      animate={{ rotate: dragAngle ?? (playing ? START + (END - START) * progress : REST) }}
      transition={
        dragAngle !== null ? { duration: 0 } : { type: 'spring', stiffness: 170, damping: 22 }
      }
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragAngle(angleAt(e));
      }}
      onPointerMove={(e) => dragAngle !== null && setDragAngle(angleAt(e))}
      onPointerUp={(e) => {
        if (dragAngle === null) return;
        const dropped = angleAt(e) > DROP;
        setDragAngle(null);
        if (dropped !== playing) onToggle();
      }}
      onPointerCancel={() => setDragAngle(null)}
    >
      <svg
        viewBox="0 0 40 240"
        className="h-full w-full cursor-grab overflow-visible active:cursor-grabbing"
      >
        <circle cx="20" cy="14" r="13" fill="#26262b" stroke="#6b6b73" />
        <circle cx="20" cy="14" r="5" fill="#a1a1aa" />
        <path
          d="M20 14 L20 186 L12 214"
          fill="none"
          stroke="#d4d4d8"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <rect
          x="3"
          y="210"
          width="15"
          height="26"
          rx="2"
          transform="rotate(14 10 222)"
          fill="#8b5cf6"
        />
      </svg>
    </motion.div>
  );
}
