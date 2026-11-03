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
 * A tonearm built the way a real one is: one straight tube through the pivot, the counterweight on
 * the same line behind it so the arm balances on the bearing, and the headshell angled off the end.
 * Drawn along a single axis, then turned to point at the record, so the parts can never drift out
 * of line. The swing is one CSS transform about the pivot (see .disc-arm).
 */
const ARM_ANGLE = 14.5; // degrees off vertical, from the pivot towards the record

function Tonearm({ on }: { on: boolean }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`disc-arm ${on ? 'disc-arm-on' : ''}`} viewBox="0 0 60 110" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}m`} x1="0" x2="1">
          <stop offset="0" stopColor="#80848e" />
          <stop offset="0.45" stopColor="#f2f3f6" />
          <stop offset="1" stopColor="#70747e" />
        </linearGradient>
        <radialGradient id={`${id}p`} cx="0.38" cy="0.32">
          <stop offset="0" stopColor="#4d5059" />
          <stop offset="1" stopColor="#141519" />
        </radialGradient>
      </defs>
      {/* Bearing housing: the round base the arm turns on */}
      <circle cx="44" cy="12" r="11.5" fill={`url(#${id}p)`} stroke="#3a3c44" strokeWidth="1" />
      <circle cx="44" cy="12" r="8" fill="none" stroke="#5f626c" strokeWidth="0.7" />
      <g transform={`rotate(${ARM_ANGLE} 44 12)`}>
        {/* Counterweight on the tube's own line, behind the pivot */}
        <rect x="41.6" y="-1" width="4.8" height="9" fill={`url(#${id}m)`} />
        <rect
          x="38.5"
          y="-13"
          width="11"
          height="12"
          rx="2.2"
          fill="#24252b"
          stroke="#80848e"
          strokeWidth="0.8"
        />
        <rect x="38.5" y="-9" width="11" height="1.2" fill="#80848e" />
        {/* The tube: straight from the bearing to the headshell */}
        <rect x="41.9" y="12" width="4.2" height="76" rx="2.1" fill="#26272c" />
        <rect x="42.5" y="12" width="3" height="76" rx="1.5" fill={`url(#${id}m)`} />
        {/* Pivot cap over the bearing */}
        <circle cx="44" cy="12" r="4.2" fill={`url(#${id}m)`} stroke="#3a3c44" strokeWidth="0.7" />
        <circle cx="44" cy="12" r="1.4" fill="#3a3c44" />
        {/* Headshell, angled off the tube, with finger lift and cartridge */}
        <g transform="rotate(24 44 88)">
          <path
            d="M39.5 87 h9 l-0.8 12 h-7.4 z"
            fill={`url(#${id}m)`}
            stroke="#555963"
            strokeWidth="0.6"
          />
          <path d="M48.3 89 l5 1.5" stroke="#c9ccd4" strokeWidth="1.3" strokeLinecap="round" />
          <rect x="40.6" y="98.5" width="6.8" height="5" rx="0.8" fill="#16171b" />
          <rect x="40.6" y="98.5" width="6.8" height="1.1" fill="#c0392b" />
        </g>
      </g>
    </svg>
  );
}
