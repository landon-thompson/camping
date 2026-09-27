import { speciesName } from './lakeSurvey';

/**
 * Small drawn fish icons: one silhouette per body type, coloured and marked
 * per species (bars, spots, stripe, ear flap, whiskers). Hand-made SVG, no
 * icon library.
 */
type Shape = 'slim' | 'deep' | 'long' | 'cat';
type Mark = 'bars' | 'spots' | 'lightSpots' | 'stripe' | 'pinkStripe' | 'ear' | 'speckle' | 'none';

interface Look {
  shape: Shape;
  body: string;
  belly: string;
  fin: string;
  mark: Mark;
  markColor: string;
}

const L = (shape: Shape, body: string, belly: string, fin: string, mark: Mark = 'none', markColor = '#000'): Look => ({ shape, body, belly, fin, mark, markColor });

const LOOKS: Record<string, Look> = {
  WAE: L('slim', '#b59a4a', '#efe3b8', '#8e7a3a', 'bars', '#6b5a2a'),
  SAR: L('slim', '#9c8a55', '#e8dcb5', '#7a6a3a', 'speckle', '#4d4128'),
  HFC: L('slim', '#a8924f', '#ece0b6', '#857339', 'bars', '#5e5028'),
  YEP: L('slim', '#d8b632', '#f3e7a6', '#d9792b', 'bars', '#3f4a22'),
  NOP: L('long', '#5d7a3a', '#dfe6c2', '#6f7f3e', 'lightSpots', '#e6e9b8'),
  MUE: L('long', '#a39a62', '#ece6c6', '#8a6b4a', 'bars', '#6c6340'),
  TME: L('long', '#9a9563', '#e9e4c4', '#85784a', 'bars', '#4e4a30'),
  LNG: L('long', '#7d7a5a', '#dcd8bd', '#6a6648', 'spots', '#3c3a2a'),
  SNG: L('long', '#7d7a5a', '#dcd8bd', '#6a6648', 'spots', '#3c3a2a'),
  BOF: L('long', '#6e7a45', '#d5d9b3', '#5a6636', 'none'),
  BUB: L('long', '#7a6a45', '#d8cfae', '#65563a', 'speckle', '#3d3322'),
  LKS: L('long', '#707a80', '#d7dcde', '#5d666b', 'none'),
  BLC: L('deep', '#b9bfae', '#eef0e6', '#8c9380', 'speckle', '#2e3326'),
  WHC: L('deep', '#c6cbbd', '#f1f3ec', '#98a08d', 'bars', '#5b6152'),
  BLG: L('deep', '#6f7f5e', '#e6c77a', '#5c6a4c', 'ear', '#1d2433'),
  PMK: L('deep', '#9a8a4f', '#f0b25a', '#7a6c3c', 'ear', '#c2332b'),
  GSF: L('deep', '#5f7f5f', '#e8d48a', '#4f6a4f', 'ear', '#1d2433'),
  HSF: L('deep', '#7a8660', '#ecc98a', '#646e4e', 'ear', '#1d2433'),
  RKB: L('deep', '#7d6a4a', '#d8c9a6', '#65563a', 'speckle', '#2e2418'),
  LMB: L('deep', '#5f7a3a', '#e3e6c2', '#56692f', 'stripe', '#2f3a1a'),
  SMB: L('deep', '#8a7440', '#e6dcb8', '#6f5d33', 'bars', '#4f4124'),
  WHB: L('deep', '#bfc6c9', '#f1f4f5', '#8f989c', 'stripe', '#6a7378'),
  TLC: L('slim', '#aebdc6', '#eef3f6', '#8a9aa3', 'none'),
  CIS: L('slim', '#aebdc6', '#eef3f6', '#8a9aa3', 'none'),
  LKW: L('slim', '#b9c2c6', '#f0f3f4', '#949ea3', 'none'),
  LAT: L('slim', '#6c7a82', '#e3e7e9', '#5a676e', 'lightSpots', '#e3e7e9'),
  RBT: L('slim', '#8a9a6a', '#eef0e2', '#76865a', 'pinkStripe', '#d9788a'),
  BNT: L('slim', '#a88a4e', '#efe0b8', '#8d713c', 'spots', '#3d2a18'),
  BKT: L('slim', '#5f6f4a', '#e6a066', '#4f5d3c', 'lightSpots', '#e9d98a'),
  SPT: L('slim', '#6f7a60', '#e6d2a8', '#5d6750', 'lightSpots', '#e3e1c0'),
  BLB: L('cat', '#3f3a30', '#b8ae94', '#2f2b24', 'none'),
  BRB: L('cat', '#6b5a3c', '#d6c9a6', '#54462f', 'speckle', '#3a2f1e'),
  YEB: L('cat', '#a68a3c', '#eedc9a', '#86702f', 'none'),
  CCF: L('cat', '#8a9aa3', '#e8edf0', '#6f7f88', 'spots', '#2f3a40'),
  FCF: L('cat', '#8a7a4a', '#e2d8b2', '#6f6238', 'speckle', '#3a321e'),
  WTS: L('slim', '#8a8778', '#e8e6de', '#716e62', 'none'),
  SHR: L('slim', '#b0975a', '#ece2c2', '#c0552f', 'none'),
  GRH: L('slim', '#bfa04a', '#efe3b4', '#b36a3a', 'none'),
  SLR: L('slim', '#b8bdb8', '#eef0ee', '#b35a3a', 'none'),
  CAP: L('deep', '#b8923c', '#ecd9a0', '#9a7a30', 'none'),
  BIB: L('deep', '#7a7a6a', '#dcdcd0', '#63635a', 'none'),
  FRD: L('deep', '#aab0b0', '#eef0f0', '#8c9292', 'none'),
  GOS: L('slim', '#c9b25a', '#f1e7b8', '#a8913f', 'none'),
  GZS: L('deep', '#b0bcc4', '#eef2f4', '#8e9aa2', 'none'),
  GOE: L('slim', '#c7c9b0', '#f2f2e6', '#a3a58c', 'none'),
  MOE: L('slim', '#c7ccd0', '#f2f3f4', '#a3a8ac', 'none'),
};
const DEFAULT_LOOK = L('slim', '#8f978f', '#e6e9e6', '#737a73', 'none');

// Silhouettes in a 64×32 box, head to the left.
const BODY: Record<Shape, string> = {
  slim: 'M4 16 C 12 7, 34 6, 48 12 L 60 5 L 58 16 L 60 27 L 48 20 C 34 26, 12 25, 4 16 Z',
  deep: 'M5 16 C 9 4, 32 1, 44 11 L 58 4 L 56 16 L 58 28 L 44 21 C 32 31, 9 28, 5 16 Z',
  long: 'M2 16 C 8 11, 40 9, 52 13 L 62 7 L 60 16 L 62 25 L 52 19 C 40 23, 8 21, 2 16 Z',
  cat: 'M3 17 C 7 8, 32 8, 48 13 L 60 6 L 58 16 L 60 26 L 48 20 C 32 26, 7 26, 3 17 Z',
};
const BELLY: Record<Shape, string> = {
  slim: 'M6 18 C 16 24, 34 25, 48 19 C 34 22, 16 22, 6 18 Z',
  deep: 'M7 19 C 12 27, 32 30, 44 21 C 32 26, 12 25, 7 19 Z',
  long: 'M4 17 C 14 21, 40 22, 52 18 C 40 20, 14 20, 4 17 Z',
  cat: 'M5 19 C 12 25, 32 25, 48 19 C 32 22, 12 22, 5 19 Z',
};
const DORSAL: Record<Shape, string> = {
  slim: 'M20 9 L 24 3 L 32 4 L 36 8 Z',
  deep: 'M16 7 L 22 1 L 34 2 L 40 9 Z',
  long: 'M40 11 L 44 7 L 49 9 L 50 12 Z',
  cat: 'M22 10 L 26 4 L 30 9 Z',
};
const EYE: Record<Shape, [number, number]> = { slim: [10, 14], deep: [11, 13], long: [8, 14.5], cat: [10, 14] };

function Markings({ look }: { look: Look }) {
  const c = look.markColor;
  switch (look.mark) {
    case 'bars':
      return (
        <g fill={c} opacity={0.55}>
          {[18, 24, 30, 36, 42].map((x) => (
            <rect key={x} x={x} y={look.shape === 'deep' ? 7 : 9} width={2.2} height={look.shape === 'deep' ? 15 : 10} rx={1} />
          ))}
        </g>
      );
    case 'spots':
    case 'lightSpots':
      return (
        <g fill={c} opacity={look.mark === 'lightSpots' ? 0.85 : 0.6}>
          {[
            [18, 12],
            [24, 15],
            [30, 11],
            [34, 16],
            [40, 13],
            [22, 18],
            [28, 19],
            [44, 15],
          ].map(([x, y]) => (
            <ellipse key={`${x}-${y}`} cx={x} cy={y} rx={1.4} ry={1} />
          ))}
        </g>
      );
    case 'speckle':
      return (
        <g fill={c} opacity={0.5}>
          {[
            [16, 11],
            [20, 15],
            [25, 10],
            [28, 17],
            [33, 13],
            [37, 18],
            [41, 12],
            [23, 20],
            [31, 21],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={1.1} />
          ))}
        </g>
      );
    case 'stripe':
    case 'pinkStripe':
      return <path d="M10 15.5 C 22 14, 36 14, 50 16" stroke={c} strokeWidth={look.mark === 'pinkStripe' ? 2.4 : 2} fill="none" opacity={0.7} strokeLinecap="round" />;
    case 'ear':
      return <ellipse cx={16} cy={15} rx={2.6} ry={2} fill={c} />;
    default:
      return null;
  }
}

export function FishIcon({ species, size = 36 }: { species: string; size?: number }) {
  const look = LOOKS[species.toUpperCase()] ?? DEFAULT_LOOK;
  const [ex, ey] = EYE[look.shape];
  return (
    <svg role="img" aria-label={speciesName(species)} viewBox="0 0 64 32" width={size} height={size / 2} className="shrink-0">
      <path d={DORSAL[look.shape]} fill={look.fin} />
      <path d={BODY[look.shape]} fill={look.body} stroke="rgba(0,0,0,0.35)" strokeWidth={0.8} />
      <path d={BELLY[look.shape]} fill={look.belly} opacity={0.9} />
      <Markings look={look} />
      {look.shape === 'cat' && (
        <g stroke={look.fin} strokeWidth={0.9} strokeLinecap="round">
          <path d="M4 16 L 0.5 13" />
          <path d="M4 18 L 0.5 21" />
          <path d="M5 19 L 2 23" />
        </g>
      )}
      <circle cx={ex} cy={ey} r={1.9} fill="#fff" />
      <circle cx={ex} cy={ey} r={1.1} fill="#111" />
    </svg>
  );
}
