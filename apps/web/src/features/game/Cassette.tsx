interface CassetteArtProps {
  playing: boolean;
  /** How far through the tape, 0 to 1: the wound tape moves from one spool to the other. */
  progress: number;
  label: string;
  /** Turns gently with no sound behind it: for a tape that is only showing, like a lobby's. */
  spinIdle?: boolean;
}

const SCREWS = [
  [14, 14],
  [306, 14],
  [14, 186],
  [306, 186],
  [160, 170],
];

function Spool({ x, tape, playing }: { x: number; tape: number; playing: boolean }) {
  return (
    <g>
      <circle cx={x} cy="90" r={tape} fill="url(#tape-wind)" />
      <g
        className="cassette-spool"
        style={{
          transformOrigin: `${x}px 90px`,
          animationPlayState: playing ? 'running' : 'paused',
        }}
      >
        <circle cx={x} cy="90" r="15" fill="#efece4" stroke="#9c988e" strokeWidth="0.75" />
        <circle cx={x} cy="90" r="9" fill="#1b1b1d" />
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <rect
            key={angle}
            x={x - 1.6}
            y="80"
            width="3.2"
            height="5.5"
            fill="#efece4"
            transform={`rotate(${angle} ${x} 90)`}
          />
        ))}
      </g>
    </g>
  );
}

/** A C-60 drawn part by part: moulded shell, screws, paper label, tape window, head opening. */
export function CassetteArt({ playing, progress, label, spinIdle = false }: CassetteArtProps) {
  const turning = playing || spinIdle;
  return (
    <svg viewBox="0 0 320 200" className="block h-auto w-full" aria-hidden="true">
      <defs>
        <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3b40" />
          <stop offset="0.5" stopColor="#242428" />
          <stop offset="1" stopColor="#151517" />
        </linearGradient>
        <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4efe2" />
          <stop offset="1" stopColor="#dcd5c3" />
        </linearGradient>
        <radialGradient id="tape-wind">
          <stop offset="0.5" stopColor="#35241a" />
          <stop offset="0.8" stopColor="#4e3526" />
          <stop offset="1" stopColor="#2b1c13" />
        </radialGradient>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
          <stop offset="0.35" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="0.07" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect x="1" y="1" width="318" height="198" rx="11" fill="url(#shell)" stroke="#000" />
      <rect
        x="4"
        y="4"
        width="312"
        height="192"
        rx="9"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.13"
      />

      <rect x="24" y="14" width="272" height="126" rx="5" fill="url(#paper)" />
      <text x="36" y="33" fontSize="15" fontWeight="800" fill="#262320">
        A
      </text>
      <text x="52" y="33" fontSize="13" fontWeight="600" fill="#262320">
        {label.length > 30 ? `${label.slice(0, 29)}…` : label}
      </text>
      <text x="284" y="33" fontSize="9" fontWeight="700" textAnchor="end" fill="#6e675a">
        C-60
      </text>
      <line x1="36" y1="41" x2="284" y2="41" stroke="#8b5cf6" strokeWidth="2" />
      <line x1="36" y1="46" x2="284" y2="46" stroke="#22b8d6" strokeWidth="1" />
      <line x1="36" y1="127" x2="284" y2="127" stroke="#8b5cf6" strokeWidth="1" />

      {/* Window: the spools and the tape on them, seen through scuffed plastic. */}
      <rect x="62" y="54" width="196" height="72" rx="6" fill="#0d0d0f" stroke="#57534a" />
      <Spool x={108} tape={35 - progress * 15} playing={turning} />
      <Spool x={212} tape={20 + progress * 15} playing={turning} />
      <rect x="62" y="54" width="196" height="72" rx="6" fill="url(#glass)" />
      <rect
        x="146"
        y="72"
        width="28"
        height="36"
        rx="2"
        fill="#000"
        fillOpacity="0.5"
        stroke="#fff"
        strokeOpacity="0.14"
      />

      {/* The raised bottom edge, with holes for the capstans and the head. */}
      <path d="M58 196 L74 148 H246 L262 196 Z" fill="#2c2c31" stroke="#000" />
      <path d="M74 148 H246" stroke="#fff" strokeOpacity="0.14" />
      {[96, 224].map((x) => (
        <circle key={x} cx={x} cy="174" r="6" fill="#050506" stroke="#55555b" strokeWidth="0.75" />
      ))}
      {[126, 194].map((x) => (
        <rect key={x} x={x - 4} y="170" width="8" height="8" rx="1" fill="#050506" />
      ))}
      <rect x="150" y="186" width="20" height="8" fill="#8e7a4e" />

      {SCREWS.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="4" fill="#77777d" stroke="#000" strokeWidth="0.75" />
          <path
            d={`M${x! - 2.5} ${y! - 1} L${x! + 2.5} ${y! + 1} M${x! - 1} ${y! + 2.5} L${x! + 1} ${y! - 2.5}`}
            stroke="#1a1a1c"
          />
        </g>
      ))}
    </svg>
  );
}

interface CassetteProps {
  playing: boolean;
  progress: number;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}

/** The player for Desi Daily and Survival. The reels only turn while audio really plays. */
export function Cassette({ playing, progress, label, disabled, onToggle }: CassetteProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={playing ? 'Stop the snippet' : 'Play the snippet'}
      className="block w-56 drop-shadow-[0_20px_30px_rgba(0,0,0,0.6)] transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:w-80"
    >
      <CassetteArt playing={playing} progress={progress} label={label} />
    </button>
  );
}
