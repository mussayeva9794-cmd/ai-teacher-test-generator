// Inline line-art illustrations in the site palette (wine, rose, peach, cream).
// Strokes marked "draw" use pathLength=1 so motion.css can draw them in.
// All are decorative: aria-hidden, no text that screen readers would need.

const WINE = "#8e1429";
const WINE_SOFT = "#ad3648";
const ROSE = "#f1e1e0";
const ROSE_LINE = "#e9b6bd";
const PEACH = "#ffd9c4";
const CREAM = "#fffcf8";
const LINE = "#e8dbd1";

type Props = { className?: string };

export function PrepareIllustration({ className = "" }: Props) {
  return (
    <svg className={`illus ${className}`} viewBox="0 0 120 84" aria-hidden="true" focusable="false">
      <rect x="22" y="8" width="58" height="70" rx="9" fill={CREAM} stroke={LINE} strokeWidth="2" />
      <path className="draw" pathLength={1} d="M34 26h30M34 37h34M34 48h22" stroke={ROSE_LINE} strokeWidth="4" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 1 }} />
      <path className="draw" pathLength={1} d="M34 60l5 5 9-10" stroke={WINE} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ ["--d" as string]: 2 }} />
      <path className="draw sparkle" pathLength={1} d="M95 14v16M87 22h16" stroke={WINE_SOFT} strokeWidth="3" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 3 }} />
      <circle cx="101" cy="44" r="3.5" fill={PEACH} />
      <circle cx="12" cy="30" r="5" fill={ROSE} />
    </svg>
  );
}

export function ShareIllustration({ className = "" }: Props) {
  return (
    <svg className={`illus ${className}`} viewBox="0 0 120 84" aria-hidden="true" focusable="false">
      <path className="draw" pathLength={1} d="M14 66c14-2 22-10 30-20s18-18 32-20" stroke={ROSE_LINE} strokeWidth="2.5" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 1 }} />
      <path d="M78 22l32-12-14 34-7-12z" fill={CREAM} stroke={WINE} strokeWidth="2.5" strokeLinejoin="round" />
      <path className="draw" pathLength={1} d="M89 32l21-22" stroke={WINE} strokeWidth="2.5" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 2 }} />
      <rect x="10" y="52" width="26" height="16" rx="8" fill={ROSE} stroke={ROSE_LINE} strokeWidth="2" />
      <rect x="28" y="62" width="26" height="16" rx="8" fill={CREAM} stroke={WINE_SOFT} strokeWidth="2" />
      <circle cx="104" cy="64" r="4" fill={PEACH} />
    </svg>
  );
}

export function ResultsIllustration({ className = "" }: Props) {
  return (
    <svg className={`illus ${className}`} viewBox="0 0 120 84" aria-hidden="true" focusable="false">
      <rect x="10" y="8" width="100" height="70" rx="12" fill={CREAM} stroke={LINE} strokeWidth="2" />
      <rect x="24" y="48" width="12" height="20" rx="4" fill={ROSE} />
      <rect x="44" y="38" width="12" height="30" rx="4" fill={ROSE_LINE} />
      <rect x="64" y="28" width="12" height="40" rx="4" fill={WINE_SOFT} />
      <rect x="84" y="20" width="12" height="48" rx="4" fill={WINE} />
      <path className="draw" pathLength={1} d="M22 40l20-10 20 4 32-18" stroke={WINE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ ["--d" as string]: 1 }} />
      <circle cx="94" cy="16" r="4" fill={PEACH} stroke={WINE} strokeWidth="2" />
    </svg>
  );
}

export function SheetsIllustration({ className = "" }: Props) {
  return (
    <svg className={`illus ${className}`} viewBox="0 0 320 300" aria-hidden="true" focusable="false">
      <circle cx="250" cy="70" r="46" fill={PEACH} opacity=".55" />
      <circle cx="60" cy="240" r="34" fill={ROSE} />
      <g transform="rotate(-9 150 160)">
        <rect x="70" y="70" width="150" height="190" rx="18" fill={ROSE} stroke={ROSE_LINE} strokeWidth="2" />
      </g>
      <g transform="rotate(5 160 150)">
        <rect x="88" y="52" width="150" height="190" rx="18" fill={CREAM} stroke={LINE} strokeWidth="2" />
        <rect x="108" y="74" width="54" height="8" rx="4" fill={WINE} opacity=".85" />
        <path className="draw" pathLength={1} d="M108 104h96M108 124h82" stroke={LINE} strokeWidth="7" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 1 }} />
        <rect x="108" y="146" width="16" height="16" rx="5" fill="#fff0ef" stroke={ROSE_LINE} strokeWidth="2" />
        <path className="draw" pathLength={1} d="M111 154l4 4 7-8" stroke={WINE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ ["--d" as string]: 2 }} />
        <path className="draw" pathLength={1} d="M134 154h62" stroke={LINE} strokeWidth="6" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 2 }} />
        <rect x="108" y="176" width="16" height="16" rx="5" fill="#fff0ef" stroke={ROSE_LINE} strokeWidth="2" />
        <path className="draw" pathLength={1} d="M111 184l4 4 7-8" stroke={WINE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ ["--d" as string]: 3 }} />
        <path className="draw" pathLength={1} d="M134 184h48" stroke={LINE} strokeWidth="6" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 3 }} />
      </g>
      <g className="float-slow">
        <rect x="196" y="196" width="94" height="56" rx="16" fill="#fff5ec" stroke={LINE} strokeWidth="2" />
        <rect x="212" y="212" width="40" height="6" rx="3" fill={ROSE_LINE} />
        <rect x="212" y="228" width="58" height="6" rx="3" fill={WINE} />
      </g>
    </svg>
  );
}

export function EmptyIllustration({ className = "" }: Props) {
  return (
    <svg className={`illus ${className}`} viewBox="0 0 200 140" aria-hidden="true" focusable="false">
      <circle cx="160" cy="34" r="22" fill={PEACH} opacity=".6" />
      <rect x="46" y="22" width="92" height="104" rx="14" fill={CREAM} stroke={LINE} strokeWidth="2" />
      <path className="draw" pathLength={1} d="M64 50h46M64 66h56M64 82h34" stroke={ROSE_LINE} strokeWidth="6" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 1 }} />
      <circle cx="138" cy="108" r="20" fill={WINE} />
      <path className="draw" pathLength={1} d="M138 99v18M129 108h18" stroke={CREAM} strokeWidth="3.5" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 2 }} />
      <path className="draw" pathLength={1} d="M28 40v12M22 46h12" stroke={WINE_SOFT} strokeWidth="2.5" strokeLinecap="round" fill="none" style={{ ["--d" as string]: 3 }} />
    </svg>
  );
}

export function SubmittedCheck({ className = "" }: Props) {
  return (
    <svg className={`illus submitted-check ${className}`} viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      <circle cx="36" cy="36" r="33" fill="#e8f4ed" />
      <circle className="draw" pathLength={1} cx="36" cy="36" r="33" stroke="#205b42" strokeWidth="2.5" fill="none" style={{ ["--d" as string]: 0 }} />
      <path className="draw" pathLength={1} d="M23 37l9 9 17-19" stroke="#205b42" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none" style={{ ["--d" as string]: 2 }} />
    </svg>
  );
}
