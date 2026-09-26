import type { SeedRecord } from './types';
import { gearSeeds } from '../features/gear/seed';
import { tripSeeds } from '../features/trips/seed';
import { reservationSeeds } from '../features/reservations/seed';
import { trailSeeds } from '../features/trails/seed';
import { journalSeeds } from '../features/journal/seed';

export type { SeedRecord } from './types';

/**
 * Starting values from the planning brief. Seeds use fixed IDs so both phones
 * create the *same* records; they are written with timestamp 0 so any real
 * edit (on either phone) always wins.
 */
const CORE_SEEDS: SeedRecord[] = [
  {
    type: 'settings',
    id: 'settings',
    data: {
      householdName: 'Our family',
      seasonYear: 2027,
      homeBase: { name: 'Roseville, MN', lat: 45.0061, lng: -93.1566 },
      people: { adults: 2, children: 1, notes: 'Toddler' },
      // Sum of mid-point estimates for the priced wishlist items in the brief
      // (~$3,000). Several items have no price yet — adjust any time.
      seasonBudgetUsd: 3000,
    },
  },
  {
    type: 'vehicle',
    id: 'vehicle:gx550',
    data: {
      name: 'GX550',
      year: 2026,
      make: 'Lexus',
      model: 'GX550',
      trim: 'Overtrail',
      payloadLb: {
        value: 1490,
        status: 'verify',
        source: 'Planning brief (approx.)',
        note: 'Read the Tire & Loading sticker on the driver door jamb and enter the exact figure.',
      },
      towRatingLb: {
        value: 9096,
        status: 'verify',
        source: 'Lexus dealer material for 2025–26 GX550 (max, properly equipped)',
        note: 'Confirm in the owner’s manual towing section for your exact build.',
      },
      roofLimitLb: {
        value: 165,
        status: 'verify',
        source: 'Owner-reported manual figure',
        note: 'Total for bars + awning + cargo. Verify in the owner’s manual.',
      },
      features: [
        'Onboard air compressor',
        'Prewired auxiliary switch panel',
        'Raised factory roof rails',
        '120 V / 400 W cargo outlet (off when ignition is off)',
      ],
      notes: [
        'Cargo 120 V outlet is limited to 400 W and turns off with the car — set the EcoFlow AC charging limit to ~300 W when charging from it.',
      ],
    },
  },
  {
    type: 'trailer',
    id: 'trailer:boat',
    data: {
      name: 'Boat package',
      description: 'Lund 1800 Tyee with Mercury 150, on its trailer',
      weightLowLb: {
        value: 3000,
        status: 'estimate',
        source: 'Placeholder from planning brief',
        note: 'Boat + motor + fuel + gear + trailer. Replace with a scale ticket.',
      },
      weightHighLb: {
        value: 3800,
        status: 'estimate',
        source: 'Placeholder from planning brief',
        note: 'Boat + motor + fuel + gear + trailer. Replace with a scale ticket.',
      },
      scaleTicketLb: {
        value: null,
        status: 'estimate',
        note: 'Weigh the loaded rig at a CAT scale (truck stop) and enter it here.',
      },
      tonguePctMin: 10,
      tonguePctMax: 15,
    },
  },
];

/** Core seeds plus each feature's own starting data. */
export const SEED_RECORDS: SeedRecord[] = [
  ...CORE_SEEDS,
  ...gearSeeds,
  ...tripSeeds,
  ...reservationSeeds,
  ...trailSeeds,
  ...journalSeeds,
];
