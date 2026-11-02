import { Disc } from './Disc';

interface AlbumSleeveProps {
  cover?: string | null;
  /** How the record sits: mostly inside, or sliding out. */
  out?: boolean;
  className?: string;
}

/** An album with its record poking out. Decorative: whoever uses it states the title in words. */
export function AlbumSleeve({ cover, out = false, className = '' }: AlbumSleeveProps) {
  return (
    <div aria-hidden="true" className={`pr-[24%] ${className}`}>
      <div className={`about-sleeve ${out ? 'about-sleeve-out' : ''}`}>
        <span className="about-sleeve-disc">
          <Disc size="100%" art={cover} />
        </span>
        <div className="about-sleeve-cover">
          {cover && <img src={cover} alt="" loading="lazy" />}
        </div>
      </div>
    </div>
  );
}
