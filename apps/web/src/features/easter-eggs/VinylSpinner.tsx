/**
 * The loading disc.
 *
 * Deliberately the same mark as the favicon in `public/disc.svg` rather than a second,
 * prettier record drawn only for this: a loader that is recognisably the app's own icon reads
 * as "Chorusify is working" instead of as generic spinner furniture. If the icon changes, this
 * path is what has to change with it.
 */
export function VinylSpinner({ size = 40, text = 'Loading...' }: { size?: number; text?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 cursor-vinyl">
      {/*
       * Spun by CSS rather than framer-motion: a constant rotation is exactly what `animate-spin`
       * is for, so the library bought nothing here and a major bump can no longer change how the
       * loader behaves. Duration is overridden because Tailwind's default 1s reads as a spinner
       * rather than a turntable.
       */}
      <svg
        // text-white rather than bare currentColor: these sit inside slate-400 blocks, so
        // inheriting would tint the disc grey against the dark background.
        className="animate-spin text-white motion-reduce:animate-none"
        style={{ animationDuration: '1.5s' }}
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="currentColor"
        // The groove arc is off-centre, so a still frame looks lopsided rather than like a
        // logo. Announced as a status image instead, and labelled by the text below.
        role="presentation"
      >
        <path d="M0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zm256 32a32 32 0 1 1 0-64 32 32 0 1 1 0 64zm-96-32a96 96 0 1 0 192 0 96 96 0 1 0 -192 0zM96 240c0-35 17.5-71.1 45.2-98.8S205 96 240 96c8.8 0 16-7.2 16-16s-7.2-16-16-16c-45.4 0-89.2 22.3-121.5 54.5S64 194.6 64 240c0 8.8 7.2 16 16 16s16-7.2 16-16z" />
      </svg>
      {text && <span className="text-sm text-slate-400 animate-pulse">{text}</span>}
    </div>
  );
}
