import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getSampler } from '../api/songs';
import { LyricStrip } from '../features/about/LyricStrip';
import { Disc } from '../features/game/Disc';
import { usePageTitle } from '../hooks/usePageTitle';

const MODES: [string, string][] = [
  ['/play', 'Daily'],
  ['/desi', 'Desi Daily'],
  ['/artist', 'Artist'],
  ['/multiplayer', 'Multiplayer'],
  ['/categories', 'Categories'],
  ['/soundtracks', 'Soundtracks'],
  ['/survival', 'Survival'],
  ['/era', 'Guess the Year'],
  ['/duels', 'Duels'],
];

const linkClass = 'text-white underline underline-offset-2 hover:text-chorusify-accent';

/** Tap works too, for screens with no hover. The words beside each object carry the content. */
function Piece({
  object,
  title,
  children,
}: {
  object: ReactNode;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex items-center gap-4 sm:flex-col sm:items-start sm:gap-5">
      <div
        aria-hidden="true"
        className={`about-object ${open ? 'about-object-open' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {object}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="font-bold text-white">{title}</h2>
        <div className="mt-1 text-sm leading-snug text-slate-300">{children}</div>
      </div>
    </section>
  );
}

/** Plastic catches the light where the pointer is, so the shine follows your hand. */
function JewelCase({ cover }: { cover?: string | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const tilt = (e: PointerEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (box)
      ref.current?.style.setProperty('--shine', `${((e.clientX - box.left) / box.width) * 100}%`);
  };
  return (
    <div ref={ref} className="jewel" onPointerMove={tilt}>
      <div className="jewel-tray">
        <Disc kind="cd" size="86%" />
      </div>
      <div className="jewel-lid">
        {cover && <img src={cover} alt="" loading="lazy" />}
        <span className="jewel-shine" />
      </div>
    </div>
  );
}

function CassettePiece() {
  return (
    <div className="tape">
      <span className="tape-label">Chorusify, side A</span>
      <span className="tape-window">
        <span className="tape-reel" />
        <span className="tape-reel" />
      </span>
    </div>
  );
}

export function AboutPage() {
  usePageTitle('About');
  const [covers, setCovers] = useState<(string | null)[]>([]);

  useEffect(() => {
    getSampler()
      .then((r) => setCovers(r.songs.map((s) => s.albumArtUrl)))
      .catch(() => setCovers([]));
  }, []);

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-between gap-4 overflow-hidden px-4 pt-4 sm:pt-8 lg:px-8">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr] sm:gap-6">
        <LyricStrip cover={covers[0]} />
        <Piece title="Nine ways to play" object={<JewelCase cover={covers[1]} />}>
          {MODES.map(([to, name], i) => (
            <span key={to}>
              {i > 0 && ', '}
              <Link to={to} className={linkClass}>
                {name}
              </Link>
            </span>
          ))}
          .
        </Piece>

        <Piece title="The small print" object={<CassettePiece />}>
          Play as a guest, or keep your stats and join the leaderboards with an account. Previews by{' '}
          <a href="https://www.deezer.com" target="_blank" rel="noreferrer" className={linkClass}>
            Deezer
          </a>
          ; recordings belong to their artists and labels. Built by{' '}
          <a
            href="https://github.com/MayurJivani"
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            Mayur Jivani
          </a>{' '}
          and{' '}
          <a
            href="https://github.com/ritwikgarg"
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            Ritwik Garg
          </a>
          .
        </Piece>
      </div>

      {/* The O is the record. Our name, on our own format. */}
      <h1 aria-label="Chorusify" className="about-wordmark group">
        <span aria-hidden="true">Ch</span>
        <span aria-hidden="true" className="about-wordmark-disc">
          <Disc size="100%" />
        </span>
        <span aria-hidden="true">rusify</span>
      </h1>
    </div>
  );
}
