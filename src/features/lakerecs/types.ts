/**
 * Lake recommender contracts (docs/LAKE_RECS_PLAN.md). Shared by the model
 * export (ml/, Python), the on-device engine (Agent C) and the UI (Agent D).
 * Change only with the coordinator: the Python exporter writes exactly this.
 */

/** `mn:<8-digit DOW>` | `sd:<slug>` */
export type LakeKey = string;
/** DNR species code, e.g. WAE. */
export type SpeciesCode = string;

// ------------------------------------------------------------ files (public/lake-model/)

/** public/lake-model/manifest.json — small; checked on every sync while online. */
export interface ModelManifest {
  format: 1;
  /** e.g. "2026.10.1" — bump means "refetch tiles you have". */
  version: string;
  createdAt: string;
  /** Git SHA of the code that fitted it. */
  codeVersion: string;
  /** Species with estimates, in picker order. */
  species: SpeciesInfo[];
  tiles: TileRef[];
  validation: ValidationSummary;
  /** Every data source used, with license/terms note and fetch date. */
  sources: { name: string; url: string; terms: string; fetchedAt: string }[];
  /** Coverage notes, e.g. "SD: 41 lakes have no parseable survey". */
  gaps: string[];
}

export interface SpeciesInfo {
  code: SpeciesCode;
  name: string;
  /** Gear the index is expressed in, e.g. "Gill net" (walleye) or "Trap net" (bluegill). */
  primaryGear: string;
  /** "fish per net" | "fish per hour" */
  unit: string;
  /** Statewide typical (median lake) catch in the primary gear, per state; index 1.0 = this. */
  typicalCpue: { MN: number | null; SD: number | null };
}

export interface TileRef {
  /** `t_<south>_<west>` on a 0.5° lat × 1° lng grid, e.g. "t_47.5_-93". */
  id: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  url: string;
  /** Uncompressed bytes (Cloudflare/Azure serve it compressed). */
  bytes: number;
  sha256: string;
  lakes: number;
}

export interface ValidationSummary {
  /** Held-out latest surveys predicted. */
  n: number;
  /** Share of held-out surveys inside the 80% predictive interval (target ≈ 0.80). */
  coverage80: number;
  /** Same for 50% intervals (target ≈ 0.50). */
  coverage50: number;
  /** Mean CRPS of log-CPUE, model vs. baseline (DNR "similar lakes" midpoint, or state median). Lower is better. */
  crpsModel: number;
  crpsBaseline: number;
  bySpecies: Record<SpeciesCode, { n: number; coverage80: number }>;
}

/** public/lake-model/tiles/<id>.json */
export interface ModelTile {
  format: 1;
  version: string;
  id: string;
  /**
   * Per species: the log-index range used to quantize samples into bytes.
   * log-index θ = ln(expected CPUE / typical CPUE); 0 = a typical lake.
   */
  scale: Record<SpeciesCode, { lo: number; hi: number }>;
  lakes: TileLake[];
}

export interface TileLake {
  key: LakeKey;
  name: string;
  state: 'MN' | 'SD';
  county: string;
  lat: number;
  lng: number;
  areaAcres: number | null;
  maxDepthFt: number | null;
  /** Secchi depth, ft. */
  clarityFt: number | null;
  /** Official page for the lake (LakeFinder) or its GFP report list. */
  sourceUrl: string;
  launches: TileLaunch[];
  /** Special regulations, quoted verbatim from the official source. Empty = none found (statewide rules still apply). */
  regs: { species: SpeciesCode | null; text: string; url: string; fetchedAt: string }[];
  stocking: { year: number; species: SpeciesCode; count: number | null; size: string }[];
  sp: Record<SpeciesCode, SpeciesEstimate>;
}

export interface TileLaunch {
  name: string;
  lat: number;
  lng: number;
  /** As the source says, e.g. "Concrete", "Gravel", "Carry-in". */
  ramp: string;
  /** Normalized from `ramp`. */
  rampClass: 'concrete' | 'gravel' | 'carry-in' | 'unknown';
  source: string;
}

export interface SpeciesEstimate {
  /** Posterior median / 10th / 90th percentile of θ (log-index). */
  med: number;
  p10: number;
  p90: number;
  /**
   * ~200 posterior samples of θ, sorted ascending, quantized to bytes on
   * tile.scale[code] and delta-encoded (first byte absolute, then
   * differences), base64. Exactly:
   *   byte_i = clamp(round((θ_i − lo) / (hi − lo) × 255), 0, 255)
   *   d_0 = byte_0, d_i = byte_i − byte_{i−1}  (≥ 0 because sorted)
   *   q = standard base64 (with padding) of the d bytes
   *   decode: byte_i = Σ_{j≤i} d_j;  θ_i = lo + byte_i / 255 × (hi − lo)
   */
  q: string;
  evidence: Evidence;
  /** Size signal: shrunken average weight ÷ similar-lake typical, or null. */
  sizeIndex: number | null;
}

export interface Evidence {
  /** Surveys of this lake with this species in any gear. */
  surveys: number;
  latestYear: number | null;
  /** 0–1: how much the estimate rests on this lake's own surveys vs. similar lakes (pooled). */
  ownWeight: number;
  /** The surveys behind it, newest first, with links. */
  sources: { date: string; type: string; gear: string; cpue: number | null; url: string }[];
}

// ------------------------------------------------------------ engine API (Agent C implements in src/features/lakerecs/)

export type RankMode = 'safe' | 'expected' | 'adventurous';

export interface RecContext {
  /** The campsite (trip location, else campground). */
  origin: { lat: number; lng: number };
  species: SpeciesCode;
  mode: RankMode;
  /** Trip dates for season fit; null = ignore season. */
  startDate: string | null;
  endDate: string | null;
  /** Towing the boat (trip.towing) — carry-in-only lakes drop out. */
  towing: boolean;
  /** Seed for Thompson sampling (stable per day unless "roll again"). */
  seed: number;
  radiusKm?: number;
}

export type FactorKey = 'fish' | 'drive' | 'launch' | 'season' | 'family';

export interface Factor {
  key: FactorKey;
  points: number;
  /** One plain sentence, e.g. "About 1.8× the walleye of a typical lake". */
  text: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface LakeRec {
  rank: number;
  lake: TileLake;
  launch: TileLaunch | null;
  distanceKm: number;
  driveMin: number;
  score: number;
  factors: Factor[];
  /** For the range bar: θ percentiles after the family-log update, as index multiples (e^θ). */
  range: { p10: number; med: number; p90: number };
  confidence: Confidence;
  confidenceText: string;
  /** 2–3 plain-language reasons, strongest first. */
  reasons: string[];
  weakSpots: string[];
  /** "Beats #3 mainly on walleye (+6 pts) despite 12 more minutes of driving." Null for the last lake. */
  vsNext: string | null;
  /** True when the family log shifted the estimate. */
  usedFamilyLog: boolean;
}

export interface RecResult {
  recs: LakeRec[];
  /** Lakes within range left out, and why ("carry-in only", "no estimate for walleye"). */
  excluded: { name: string; why: string }[];
  modelVersion: string | null;
  /** Tiles needed for this origin that aren't on the phone yet. */
  missingTiles: string[];
}

// ------------------------------------------------------------ hooks (Agent C implements; Agent D consumes)
// Module: src/features/lakerecs/index.ts exports
//   useLakeRecs(ctx: Omit<RecContext, 'seed'> | null): UseLakeRecs
//   useLakeModelStatus(): LakeModelStatus & { update(): Promise<void> }
//   saveFishingLog(log: FishingLog): Promise<string>   // returns the record id
//   recommendLakes(ctx: RecContext, data: { tiles: ModelTile[]; logs: FishingLog[]; manifest: ModelManifest | null }): RecResult
//   DEFAULT_WEIGHTS

export interface LakeModelStatus {
  state: 'none' | 'loading' | 'ready' | 'updating' | 'offline' | 'error';
  version: string | null;
  createdAt: string | null;
  tilesOnPhone: number;
  /** Uncompressed bytes of model data stored on the phone. */
  bytesOnPhone: number;
  message?: string;
}

export interface UseLakeRecs {
  loading: boolean;
  result: RecResult | null;
  status: LakeModelStatus;
  /** Download the tiles this origin needs (no-op offline). */
  download(): Promise<void>;
  /** Adventurous mode: new random draw. */
  rollAgain(): void;
}
