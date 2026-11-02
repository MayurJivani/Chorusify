import { memo, type ReactNode } from 'react';

interface DiscProps {
  /** Vinyl with grooves, a CD with a mirror band, or a gold record for the winner. */
  kind?: 'vinyl' | 'cd' | 'gold';
  /** CSS size, so a disc can follow its container. */
  size?: number | string;
  spinning?: boolean;
  /** Printed on the label. Turns with the disc. */
  art?: string | null;
  /** Upright content at the centre, such as a player count. Replaces the art. */
  children?: ReactNode;
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
    </span>
  );
});
