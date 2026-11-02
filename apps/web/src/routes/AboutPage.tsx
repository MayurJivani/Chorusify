import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { getSampler, type SamplerSong } from '../api/songs';
import { LYRICS, lineAt } from '../features/about/lyrics';
import { CassetteArt } from '../features/game/Cassette';
import { Disc } from '../features/game/Disc';
import { useSectionProgress } from '../hooks/useSectionProgress';
import { usePageTitle } from '../hooks/usePageTitle';

const MODES: [string, string, string][] = [
  ['/play', 'Daily', 'Five English songs, the same for everyone'],
  ['/desi', 'Desi Daily', 'Five Indian songs, with its own streak'],
  ['/artist', 'Artist Mode', 'Any discography, ten songs'],
  ['/multiplayer', 'Multiplayer', 'A room of friends, same snippet'],
  ['/categories', 'Categories', 'One chart, year or genre'],
  ['/soundtracks', 'Soundtracks', 'Name what the music is from'],
  ['/survival', 'Survival', 'One wrong answer ends the run'],
  ['/era', 'Guess the Year', 'Place a song in time'],
  ['/duels', 'Duels', 'Rated 1v1 over the same ten songs'],
];

const linkClass = 'text-white underline underline-offset-2 hover:text-chorusify-accent';

/** Everything below the lyrics: one object per section, sliding up as it arrives. */
function Shelf({ children, flip = false }: { children: ReactNode; flip?: boolean }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className={`mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 md:grid-cols-2 md:gap-16 md:py-20 lg:px-8 ${flip ? '[&>*:first-child]:md:order-2' : ''}`}
    >
      {children}
    </motion.section>
  );
}

function VinylSection({ cover, total }: { cover?: string | null; total: number }) {
  const [out, setOut] = useState(false);
  return (
    <Shelf>
      <div aria-hidden="true" className="pr-[22%]">
        <div
          className={`about-sleeve ${out ? 'about-sleeve-out' : ''}`}
          onClick={() => setOut((o) => !o)}
        >
          <span className="about-sleeve-disc">
            <Disc size="100%" art={cover} />
          </span>
          <div className="about-sleeve-cover">
            {cover && <img src={cover} alt="" loading="lazy" />}
          </div>
        </div>
      </div>
      <div>
        <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
          A very big crate
        </h2>
        <p className="mt-3 text-lg leading-relaxed text-slate-300">
          {total > 0 ? `${total.toLocaleString()} songs` : 'Thousands of songs'} and counting: Hindi
          classics, Hindi indie, Punjabi, K-pop, metal, jazz and plenty more. Originals only.
        </p>
      </div>
    </Shelf>
  );
}

function CdSection({ cover }: { cover?: string | null }) {
  const caseRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const shine = (e: PointerEvent) => {
    const box = caseRef.current?.getBoundingClientRect();
    if (box) {
      caseRef.current?.style.setProperty(
        '--shine',
        `${((e.clientX - box.left) / box.width) * 100}%`,
      );
    }
  };
  return (
    <Shelf flip>
      <div aria-hidden="true" className="mx-auto w-full max-w-md">
        <div
          ref={caseRef}
          className={`jewel ${open ? 'jewel-open' : ''}`}
          onPointerMove={shine}
          onClick={() => setOpen((o) => !o)}
        >
          <div className="jewel-tray">
            <Disc kind="cd" size="86%" />
          </div>
          <div className="jewel-lid">
            {cover && <img src={cover} alt="" loading="lazy" />}
            <span className="jewel-shine" />
          </div>
        </div>
      </div>
      <div>
        <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Ways to play</h2>
        <ol className="mt-4 border-t border-white/15">
          {MODES.map(([to, name, line], i) => (
            <li key={to} className="border-b border-white/15">
              <Link
                to={to}
                className="group flex items-baseline gap-3 py-2 transition-colors hover:text-chorusify-accent"
              >
                <span className="w-5 flex-none font-mono text-xs text-slate-500">{i + 1}</span>
                <span className="flex-none font-semibold text-white group-hover:text-chorusify-accent">
                  {name}
                </span>
                <span className="min-w-0 truncate text-sm text-slate-400">{line}</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </Shelf>
  );
}

function CassetteSection() {
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState(false);
  return (
    <Shelf>
      <div
        aria-hidden="true"
        className="mx-auto w-full max-w-lg cursor-pointer drop-shadow-[0_24px_36px_rgba(0,0,0,0.65)] transition-transform duration-300 hover:-rotate-1"
        onPointerEnter={(e) => e.pointerType === 'mouse' && setPlaying(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setPlaying(false)}
        onClick={() => setHeld((h) => !h)}
      >
        <CassetteArt playing={playing || held} progress={0.35} label="Chorusify, the small print" />
      </div>
      <div>
        <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
          The small print
        </h2>
        <div className="mt-3 space-y-3 text-lg leading-relaxed text-slate-300">
          <p>
            Play as a guest with no account. Make one to keep your stats on every device and join
            the leaderboards.
          </p>
          <p>
            Previews are provided by{' '}
            <a href="https://www.deezer.com" target="_blank" rel="noreferrer" className={linkClass}>
              Deezer
            </a>
            . Recordings belong to their artists and labels.
          </p>
          <p>
            Built by{' '}
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
          </p>
        </div>
      </div>
    </Shelf>
  );
}

/** For anyone who asked for less motion: the same words, just a page to read. */
function PlainLyrics() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3 px-4 py-10">
      <h1 className="text-4xl font-extrabold text-white">About Chorusify</h1>
      {LYRICS.flatMap((s) => s.lines).map((line) => (
        <p key={line} className="text-lg leading-relaxed text-slate-300">
          {line}
        </p>
      ))}
    </div>
  );
}

/** Every line in order, each knowing its section. */
const SHEET = LYRICS.flatMap((section, s) => section.lines.map((text) => ({ text, section: s })));

export function AboutPage() {
  usePageTitle('About');
  const reduced = useReducedMotion();
  const [songs, setSongs] = useState<SamplerSong[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    getSampler()
      .then((r) => {
        setSongs(r.songs);
        setTotal(r.total);
      })
      .catch(() => setSongs([]));
  }, []);

  const covers = useMemo(
    () => [...new Set(songs.map((s) => s.albumArtUrl).filter(Boolean))] as string[],
    [songs],
  );

  return (
    <>
      {reduced ? <PlainLyrics /> : <LyricSheet covers={covers} />}
      <VinylSection cover={covers[2]} total={total} />
      <CdSection cover={covers[3]} />
      <CassetteSection />
      <p
        aria-hidden="true"
        className="overflow-visible whitespace-nowrap pb-[0.08em] pt-8 text-center text-[18vw] font-black leading-[1.1] tracking-tighter text-neutral-200"
      >
        Chorusify
      </p>
    </>
  );
}

/** The page as a lyric sheet: scrolling sings it, one line at a time, over the record's colours. */
function LyricSheet({ covers }: { covers: string[] }) {
  const track = useRef<HTMLDivElement | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const progress = useSectionProgress(track, 0, 1);
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState(0);

  const section = SHEET[active]?.section ?? 0;
  const cover = covers.length ? covers[section % covers.length] : null;

  useMotionValueEvent(progress, 'change', (p) => {
    const { index, through } = lineAt(p, SHEET.length);
    setActive(index);
    if (bar.current) bar.current.style.transform = `scaleX(${p})`;
    // Fill word by word without a re-render per scroll tick.
    const words = sheet.current?.children[index]?.querySelectorAll<HTMLElement>('.lyric-word');
    if (!words) return;
    const total = words.length;
    words.forEach((word, i) => {
      const fill = Math.min(1, Math.max(0, through * total - i));
      word.style.setProperty('--p', `${fill * 124 - 12}%`);
    });
  });

  // Hold the current line just above the middle of the window.
  useLayoutEffect(() => {
    const measure = () => {
      const line = sheet.current?.children[active] as HTMLElement | undefined;
      const height = viewport.current?.clientHeight ?? 0;
      if (line) setOffset(height * 0.42 - (line.offsetTop + line.offsetHeight / 2));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);

  return (
    <div ref={track} style={{ height: `${SHEET.length * 55 + 60}vh` }} className="relative">
      <div className="sticky top-0 h-[calc(100dvh-89px)] overflow-hidden sm:h-[calc(100dvh-114px)]">
        <div aria-hidden="true" className="absolute inset-0 bg-black">
          <AnimatePresence initial={false}>
            {cover && (
              <motion.img
                key={cover}
                src={cover}
                alt=""
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.8 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.2 }}
                className="absolute inset-0 h-full w-full scale-[1.4] object-cover blur-[70px] saturate-[1.6]"
              />
            )}
          </AnimatePresence>
          <div className="absolute inset-0 bg-black/55" />
        </div>

        <div className="relative mx-auto grid h-full max-w-6xl grid-rows-[auto_1fr] gap-4 px-4 py-4 lg:grid-cols-[0.8fr_1.3fr] lg:grid-rows-1 lg:gap-14 lg:px-8">
          <aside className="flex flex-col justify-center gap-3 lg:gap-6">
            <h1 className="hidden text-5xl font-black leading-none tracking-tight text-white lg:block">
              About
              <br />
              Chorusify
            </h1>
            <div className="max-w-sm rounded-2xl border border-white/15 bg-black/40 p-3 backdrop-blur-xl lg:p-4">
              <div className="flex items-center gap-3">
                {cover ? (
                  <img src={cover} alt="" className="h-11 w-11 rounded-md object-cover" />
                ) : (
                  <span className="h-11 w-11 rounded-md bg-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-white">{LYRICS[section]?.title}</p>
                  <p className="text-xs text-slate-300">
                    Line {active + 1} of {SHEET.length}
                  </p>
                </div>
              </div>
              <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-white/15">
                <div ref={bar} className="h-full origin-left scale-x-0 rounded-full bg-white" />
              </div>
            </div>
            <p className="hidden text-sm text-slate-300 lg:block">Scroll to sing along.</p>
          </aside>

          <div
            ref={viewport}
            className="relative min-h-0 overflow-hidden [mask-image:linear-gradient(180deg,transparent,#000_16%,#000_78%,transparent)]"
          >
            <motion.div
              ref={sheet}
              animate={{ y: offset }}
              transition={{ type: 'spring', stiffness: 90, damping: 20 }}
            >
              {SHEET.map((line, i) => (
                <p
                  key={line.text}
                  aria-current={i === active ? 'true' : undefined}
                  className={`lyric-line ${i === active ? 'lyric-line-active' : i < active ? 'lyric-line-past' : ''}`}
                >
                  {line.text.split(' ').map((word, w) => (
                    <span key={w} className="lyric-word">
                      {word}{' '}
                    </span>
                  ))}
                </p>
              ))}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
