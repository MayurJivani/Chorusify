import { motion } from 'motion/react';
import { AVATARS, type AvatarId } from './avatars';

/** A row of instruments to play as. Radio buttons underneath, so it works by keyboard. */
export function AvatarPicker({
  value,
  onChange,
}: {
  value: AvatarId;
  onChange: (id: AvatarId) => void;
}) {
  return (
    <fieldset className="w-full">
      <legend className="mb-2 text-sm text-slate-400">Pick your sound</legend>
      <div className="grid grid-cols-8 gap-1.5">
        {AVATARS.map((a) => {
          const on = a.id === value;
          return (
            <label
              key={a.id}
              title={a.label}
              className={`relative flex aspect-square cursor-pointer items-center justify-center rounded-xl text-xl transition-colors ${
                on ? 'bg-white/15 ring-2 ring-white/70' : 'bg-white/[0.05] hover:bg-white/10'
              }`}
            >
              <input
                type="radio"
                name="avatar"
                value={a.id}
                checked={on}
                onChange={() => onChange(a.id)}
                className="sr-only"
                aria-label={a.label}
              />
              <motion.span
                animate={{ scale: on ? 1.18 : 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              >
                {a.glyph}
              </motion.span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
