import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { getSampler, type SamplerSong } from '../api/songs';
import { LYRICS, lineAt } from '../features/about/lyrics';
import { PlayableKeys } from '../features/about/PlayableKeys';
import { useSectionProgress } from '../hooks/useSectionProgress';
import { usePageTitle } from '../hooks/usePageTitle';

const team = [
  { name: 'Mayur Jivani', github: 'https://github.com/MayurJivani' },
  { name: 'Ritwik Garg', github: 'https://github.com/ritwikgarg' },
];

const linkClass = 'underline underline-offset-2 hover:text-white';

/** Every line in order, each knowing its section. */
const SHEET = LYRICS.flatMap((section, s) => section.lines.map((text) => ({ text, section: s })));

function Links() {
  return (
    <p className="text-xs leading-relaxed text-slate-300">
      Previews by{' '}
      <a href="https://www.deezer.com" target="_blank" rel="noreferrer" className={linkClass}>
        Deezer
      </a>
      . Built by{' '}
      {team.map((member, i) => (
        <span key={member.github}>
          {i > 0 && ' and '}
          <a href={member.github} target="_blank" rel="noreferrer" className={linkClass}>
            {member.name}
          </a>
        </span>
      ))}
      .
    </p>
  );
}

/** For anyone who asked for less motion: the same words, just a page to read. */
function PlainSheet() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8">
      <h1 className="text-4xl font-extrabold text-white">About Chorusify</h1>
      {LYRICS.map((section) => (
        <section key={section.title} className="flex flex-col gap-2">
          <h2 className="text-xl font-bold text-white">{section.title}</h2>
          {section.lines.map((line) => (
            <p key={line} className="leading-relaxed text-slate-300">
              {line}
            </p>
          ))}
        </section>
      ))}
      <Links />
    </div>
  );
}

export function AboutPage() {
  usePageTitle('About');
  const reduced = useReducedMotion();
  return (
    <>
      {reduced ? <PlainSheet /> : <LyricSheet />}
      <section className="overflow-hidden bg-black px-4 pt-14 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
              Play the chorus.
            </h2>
            <p className="hidden font-mono text-xs uppercase tracking-widest text-slate-400 lg:block">
              Keyboard: A S D F G H J K, W E T Y U
            </p>
          </div>
          <PlayableKeys />
        </div>
        {/* Cropped by the page edge on purpose: the name as a closing poster. */}
        <p
          aria-hidden="true"
          className="-mb-[0.32em] mt-10 whitespace-nowrap text-center text-[clamp(4rem,20vw,20rem)] font-black leading-none tracking-tighter text-neutral-200"
        >
          Chorusify
        </p>
      </section>
    </>
  );
}

/** The page as a lyric sheet: scrolling sings it, one line at a time, over the record's colours. */
function LyricSheet() {
  const [songs, setSongs] = useState<SamplerSong[]>([]);
  const track = useRef<HTMLDivElement | null>(null);
  const viewport = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const progress = useSectionProgress(track, 0, 1);
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    getSampler()
      .then((r) => setSongs(r.songs))
      .catch(() => setSongs([]));
  }, []);

  // One cover per section. Falls back to plain ground if the sampler has none.
  const covers = useMemo(
    () => [...new Set(songs.map((s) => s.albumArtUrl).filter(Boolean))] as string[],
    [songs],
  );
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
    <div ref={track} style={{ height: `${SHEET.length * 42}vh` }} className="relative">
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
              <div className="mt-3">
                <Links />
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
