import { memo, useId, type ReactNode } from 'react';

interface DiscProps {
  /** Vinyl with grooves, or a CD with a mirror band (the About page's case). */
  kind?: 'vinyl' | 'cd';
  /** CSS size, so a disc can follow its container. */
  size?: number | string;
  spinning?: boolean;
  /** Printed on the label. Turns with the disc. */
  art?: string | null;
  /** Upright content at the centre, such as a player count. Replaces the art. */
  children?: ReactNode;
  /** A tonearm that drops onto the record while it plays. Vinyl only. */
  arm?: boolean;
  className?: string;
}

/**
 * A record or CD with a real surface.
 *
 * Two layers, the way the real thing behaves: the disc turns, but the highlights belong to the room
 * and stay still, so the light slides across the grooves. Only the lower layer animates, and only
 * its transform, so one on screen costs the phone almost nothing. It stops when nothing is playing
 * and for anyone who asked for reduced motion. Styles are in index.css.
 */
export const Disc = memo(function Disc({
  kind = 'vinyl',
  size = 96,
  spinning = false,
  art,
  children,
  arm = false,
  className = '',
}: DiscProps) {
  return (
    <span
      aria-hidden={children ? undefined : true}
      className={`disc disc-${kind} ${className}`}
      style={{ width: size, height: size }}
    >
      <span className={`disc-body ${spinning ? 'disc-spinning' : ''}`}>
        <span className="disc-label">
          {art && !children && <img src={art} alt="" loading="lazy" />}
        </span>
      </span>
      <span className="disc-light" />
      {children ? <span className="disc-center">{children}</span> : <span className="disc-hole" />}
      {arm && kind === 'vinyl' && <Tonearm on={spinning} />}
    </span>
  );
});

/**
 * A tonearm drawn the way a real one is built: plinth and pivot, a counterweight behind it, an
 * S-curved tube, and a headshell carrying the cartridge. The swing is one CSS transform about the
 * pivot (see .disc-arm), so it costs nothing extra while the record turns.
 */
function Tonearm({ on }: { on: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`disc-arm ${on ? 'disc-arm-on' : ''}`} viewBox="0 0 60 110" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}m`} x1="0" x2="1">
          <stop offset="0" stopColor="#8d919b" />
          <stop offset="0.45" stopColor="#f1f2f5" />
          <stop offset="1" stopColor="#7a7e88" />
        </linearGradient>
        <radialGradient id={`${id}p`} cx="0.35" cy="0.3">
          <stop offset="0" stopColor="#5a5d66" />
          <stop offset="1" stopColor="#17181c" />
        </radialGradient>
      </defs>
      {/* Plinth and bearing */}
      <circle cx="44" cy="12" r="11" fill={`url(#${id}p)`} stroke="#3b3d45" strokeWidth="1" />
      <circle cx="44" cy="12" r="6.5" fill="none" stroke="#6d707a" strokeWidth="0.8" />
      {/* Counterweight, behind the pivot */}
      <rect
        x="45.5"
        y="-2.5"
        width="9"
        height="11"
        rx="2.5"
        transform="rotate(28 50 3)"
        fill="#2c2d33"
        stroke="#7a7e88"
        strokeWidth="0.8"
      />
      {/* Arm tube */}
      <path
        d="M44 12 C44 38 47 56 40 74 L27 91"
        fill="none"
        stroke="#2a2b30"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      <path
        d="M44 12 C44 38 47 56 40 74 L27 91"
        fill="none"
        stroke={`url(#${id}m)`}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="44" cy="12" r="3.2" fill={`url(#${id}m)`} stroke="#3b3d45" strokeWidth="0.6" />
      {/* Headshell, finger lift and cartridge */}
      <g transform="rotate(-38 22 95)">
        <path
          d="M14 90 h15 l-1.5 9 h-12 z"
          fill={`url(#${id}m)`}
          stroke="#555963"
          strokeWidth="0.7"
        />
        <path d="M29 92 l6 -3" stroke="#c9ccd4" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="16.5" y="98.5" width="9" height="4.5" rx="0.8" fill="#16171b" />
        <rect x="16.5" y="98.5" width="9" height="1.2" fill="#c0392b" />
      </g>
    </svg>
  );
}
