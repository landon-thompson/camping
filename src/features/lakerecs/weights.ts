import type { SpecStatus } from '../../model/core';
import type { SpeciesCode } from './types';

/**
 * Scoring weights for the lake recommender (docs/LAKE_RECS_PLAN.md §4). These
 * are editable data, not facts: every number says how much to trust it. A
 * `Weight` is assignable to the app's `SpecNumber`.
 *
 * Nothing here is a legal season, limit or regulation. The season table is a
 * rough "how's the bite" guess for family open-water fishing; legal seasons
 * come from the DNR/GFP regulations booklet only.
 */
export interface Weight {
  value: number;
  status: SpecStatus;
  note: string;
}

/** Season fit, Jan…Dec, each −5…+5 points (estimate). */
export interface SeasonRow {
  months: [number, number, number, number, number, number, number, number, number, number, number, number];
  status: SpecStatus;
  note: string;
}

export interface LakeRecWeights {
  /** Points per doubling of the fish index vs. a typical lake (fish = k × log2(index)). */
  fishPerDoubling: Weight;
  /** Minutes of driving that cost nothing. */
  driveFreeMin: Weight;
  /** Points lost per 5 minutes beyond the free minutes (one way). */
  drivePointsPer5Min: Weight;
  /** Straight-line km × this = road km (no road network offline). */
  roadFactor: Weight;
  /** Average speed on those roads. */
  speedKmh: Weight;
  /** Ramp points when towing (all 0 when not towing). */
  launch: Record<'concrete' | 'gravel' | 'unknown' | 'carry-in', Weight>;
  season: Record<SpeciesCode, SeasonRow>;
  /** Highest family-history bonus (a 5/5 average). */
  familyMaxPoints: Weight;
  /** Average rating at or below this earns nothing; 5/5 earns the max, linear between. */
  familyZeroRating: Weight;
  /** Tempering w for the family-log update (angler catch is a noisy, biased view of survey abundance). */
  journalTempering: Weight;
  /** r_s: fish per hour a family party catches at a typical lake (index 1.0), per species. */
  catchRatePerHour: Record<SpeciesCode, Weight>;
  /** Used for species missing from `catchRatePerHour`. */
  catchRateDefault: Weight;
  confidence: {
    highOwnWeight: number;
    highMinSurveys: number;
    highMaxAgeYears: number;
    /** p90 ÷ p10 (as index multiples) at most this for "high". */
    highMaxSpread: number;
    mediumOwnWeight: number;
    mediumMaxAgeYears: number;
  };
  weakSpots: {
    oldSurveyYears: number;
    pooledOwnWeight: number;
    longDriveMin: number;
    /** p90 ÷ p10 above this is called out as a wide range. */
    wideSpread: number;
  };
  /** Lakes just past the radius (up to this × radius) are listed as excluded "a bit too far". */
  nearMissFactor: number;
}

const est = (value: number, note: string): Weight => ({ value, status: 'estimate', note });
type Months = SeasonRow['months'];
const season = (months: Months, note: string): SeasonRow => ({ months, status: 'estimate', note });

export const DEFAULT_WEIGHTS: LakeRecWeights = {
  fishPerDoubling: est(10, 'Twice the fish of a typical lake is worth 10 points (plan default).'),
  driveFreeMin: est(10, 'The first 10 minutes of driving are free (plan default).'),
  drivePointsPer5Min: est(1, 'Each extra 5 minutes one way costs 1 point (plan default).'),
  roadFactor: est(1.35, 'Roads are about 1.35× the straight-line distance (plan default).'),
  speedKmh: est(70, 'About 70 km/h average on rural roads (plan default).'),
  launch: {
    concrete: est(0, 'Concrete ramp: no penalty.'),
    gravel: est(-2, 'Gravel ramp: a little harder with the trailer.'),
    unknown: est(-3, 'Ramp type not listed: might be rough; check first.'),
    'carry-in': est(-15, 'Carry-in only: the trailered boat cannot launch.'),
  },
  // Rough bite expectations for open-water family fishing, kept modest (±3 at most).
  // Not legal seasons: check the regulations booklet for open dates.
  season: {
    WAE: season([0, 0, -1, -1, 2, 3, 1, -1, 1, 1, -1, 0], 'Walleye often bite well in shallower water in late spring and early summer, slow in late summer, pick up in fall.'),
    SAR: season([0, 0, -1, -1, 1, 2, 1, -1, 1, 1, 0, 0], 'Sauger follow a pattern like walleye, a bit flatter.'),
    NOP: season([0, 0, 0, 0, 2, 2, 0, -1, 1, 1, 0, 0], 'Pike are active in cool water: late spring and fall are usually better than midsummer.'),
    MUE: season([0, 0, 0, 0, -1, 0, 1, 1, 2, 2, 0, 0], 'Muskies are hard to catch any time; late summer and fall are usually best.'),
    YEP: season([0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0], 'Perch bite fairly steadily through summer.'),
    BLC: season([0, 0, 0, 0, 3, 2, 0, -1, 1, 1, 0, 0], 'Crappies move shallow around spawning in late spring, then scatter in summer.'),
    BLG: season([0, 0, 0, 0, 1, 3, 2, 1, 0, 0, 0, 0], 'Sunfish are easiest to find on shallow beds in early summer.'),
    PMK: season([0, 0, 0, 0, 1, 2, 2, 1, 0, 0, 0, 0], 'Pumpkinseed behave much like bluegill.'),
    LMB: season([-1, -1, -1, 0, 1, 2, 2, 1, 1, 0, -1, -1], 'Largemouth like warm water: early to midsummer is usually best.'),
    SMB: season([-1, -1, -1, 0, 1, 2, 2, 1, 2, 0, -1, -1], 'Smallmouth are active in summer and often again in early fall.'),
  },
  familyMaxPoints: est(4, 'A lake you loved (5/5) earns up to 4 points.'),
  familyZeroRating: est(2, 'An average rating of 2/5 or lower earns nothing.'),
  journalTempering: est(0.5, 'Our own catches count half: a few outings say less than a net survey.'),
  // Conservative fish/hour for a family party (one boat, a toddler aboard) at a typical lake.
  catchRatePerHour: {
    WAE: est(0.3, 'Walleye: about one fish every 3 hours at a typical lake.'),
    SAR: est(0.3, 'Sauger: similar to walleye.'),
    NOP: est(0.4, 'Pike: a fish every 2–3 hours.'),
    MUE: est(0.03, 'Muskie: rare for casual anglers.'),
    YEP: est(1.5, 'Perch: often a few an hour once found.'),
    BLC: est(0.8, 'Crappie: about one an hour on average.'),
    BLG: est(2, 'Bluegill: a couple an hour from shore or dock.'),
    PMK: est(1, 'Pumpkinseed: about one an hour.'),
    RKB: est(0.8, 'Rock bass: about one an hour.'),
    LMB: est(0.5, 'Largemouth: one every couple of hours.'),
    SMB: est(0.5, 'Smallmouth: one every couple of hours.'),
    LAT: est(0.1, 'Lake trout: slow without special gear.'),
    RBT: est(0.4, 'Rainbow trout: modest in stocked lakes.'),
    BKT: est(0.4, 'Brook trout: modest.'),
    BNT: est(0.15, 'Brown trout: slow.'),
  },
  catchRateDefault: est(0.5, 'Other species: one every couple of hours.'),
  confidence: {
    highOwnWeight: 0.6,
    highMinSurveys: 2,
    highMaxAgeYears: 6,
    highMaxSpread: 4,
    mediumOwnWeight: 0.3,
    mediumMaxAgeYears: 12,
  },
  weakSpots: {
    oldSurveyYears: 8,
    pooledOwnWeight: 0.3,
    longDriveMin: 35,
    wideSpread: 6,
  },
  nearMissFactor: 1.25,
};

export function catchRate(w: LakeRecWeights, species: SpeciesCode): number {
  return (w.catchRatePerHour[species] ?? w.catchRateDefault).value;
}
