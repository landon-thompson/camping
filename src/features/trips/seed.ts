import { seed, type SeedRecord } from '../../seed/types';
import type { Trip } from '../../model/schemas';

/**
 * The five-trip season progression from the planning brief. Dates, exact
 * location and campground all start null/none — the owner sets them once
 * real plans exist. Never invent coordinates.
 */
const unset: Pick<Trip, 'status' | 'startDate' | 'endDate' | 'campgroundId' | 'location' | 'boatLaunch' | 'gearIds' | 'peakSunHours'> = {
  status: 'idea',
  startDate: null,
  endDate: null,
  campgroundId: null,
  location: null,
  boatLaunch: null,
  gearIds: [],
  peakSunHours: null,
};

export const tripSeeds: SeedRecord[] = [
  seed('trip', 'trip:1-shakedown', {
    ...unset,
    name: 'Shakedown',
    level: 1,
    targetWindow: 'late May / early June',
    kinds: ['electric', 'boat', 'toddler'],
    towing: true,
    notes:
      '1–2 nights at a state park near home, on an electric site with a boat launch — tow the boat and shake down the whole rig ' +
      'before the season gets going.',
  }),
  seed('trip', 'trip:2-lake-weekend', {
    ...unset,
    name: 'Lake weekend, no hookup',
    level: 2,
    targetWindow: 'June',
    kinds: ['no-hookup', 'boat', 'toddler'],
    towing: true,
    notes:
      '2–3 nights at a non-electric lake campground — first real test of the EcoFlow + solar setup off the grid. Boat days, ' +
      'peak bug season.',
  }),
  seed('trip', 'trip:3-rustic-nf', {
    ...unset,
    name: 'Rustic national forest campground',
    level: 3,
    targetWindow: 'July',
    kinds: ['no-hookup', 'boat', 'toddler'],
    towing: true,
    notes:
      '3 nights at a rustic Superior or Chippewa National Forest campground with a lake and boat launch, reached on gravel ' +
      'roads.',
  }),
  seed('trip', 'trip:4-boat-in', {
    ...unset,
    name: 'Boat-in',
    level: 4,
    targetWindow: 'August',
    kinds: ['no-hookup', 'boat', 'toddler'],
    towing: true,
    notes:
      'Lake Vermilion, Hinsdale Island boat-in sites — free, first-come (the plan said USFS; research points to Kabetogama State Forest / MN DNR — verify). Leave the GX at the landing and boat everything ' +
      'in.',
  }),
  seed('trip', 'trip:5-offgrid', {
    ...unset,
    name: 'Off-grid finale',
    level: 5,
    targetWindow: 'late August / September',
    kinds: ['off-grid', 'no-hookup', 'toddler'],
    towing: false,
    notes:
      '3–4 nights dispersed on MVUM-designated roads in Superior National Forest, outside the BWCA Wilderness. No boat this ' +
      'trip — start easy, e.g. Norway Point on the St. Louis River (verify).',
  }),
];
