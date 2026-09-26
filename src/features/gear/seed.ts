import { seed } from '../../seed/types';
import type { SeedRecord } from '../../seed/types';
import { CATEGORIES, GEAR, categoryId } from './seedData';
import type { ChecklistTemplate } from '../../model/schemas';

const categorySeeds: SeedRecord[] = CATEGORIES.map((c) => seed('budget_category', categoryId(c.key), c.data));
const gearItemSeeds: SeedRecord[] = GEAR.map((g) => seed('gear', g.id, g.data));

/** Build a checklist template seed with auto-numbered item ids. */
function checklist(
  key: string,
  name: string,
  kind: ChecklistTemplate['kind'],
  items: string[],
  opts: { source?: string; description?: string } = {},
): SeedRecord {
  return seed('checklist_template', `checklist_template:${key}`, {
    name,
    kind,
    description: opts.description ?? '',
    source: opts.source ?? '',
    items: items.map((text, i) => ({ id: `${key}-${i + 1}`, text })),
  });
}

const checklistSeeds: SeedRecord[] = [
  checklist(
    'boat',
    'Boat trip / Minnesota AIS law',
    'boat',
    [
      'Pull the drain plug and drain all water before leaving the access',
      'Remove aquatic plants and animals',
      'Keep the drain plug out during transport',
      'PFDs for everyone (infant/child PFD fitted)',
    ],
    { source: 'Minnesota aquatic invasive species (AIS) law — verify current rules with the MN DNR' },
  ),
  checklist('no-hookup', 'No-hookup', 'no-hookup', [
    'EcoFlow full',
    'AC charge limit set (~300 W for the cargo outlet)',
    'Solar panel + MC4-to-XT60 adapter',
    'Fridge pre-cooled at home',
  ]),
  checklist('off-grid', 'Off-grid', 'off-grid', [
    'Offline maps downloaded (in-app and onX)',
    'MVUM for the district',
    'Satellite messenger charged',
    'Recovery kit',
    'Saw',
    'Extra water',
    'Air-down / air-up plan',
    'Food storage: food and trash locked in the car overnight',
  ]),
  checklist('toddler', 'Toddler', 'toddler', ['Sleep setup', 'Bug protection', 'Snacks', 'Meds', 'Play tent', 'High chair']),
  checklist('departure', 'Departure / pack-out', 'departure', ['Stove and propane off', 'Trash packed out', 'Site check']),
];

const weightPlaceholder = (value: number) =>
  ({ value, status: 'estimate', note: 'placeholder — enter real weights' }) as const;

const loadProfileSeed: SeedRecord = seed('load_profile', 'load_profile:default', {
  people: [
    { id: 'adult1', label: 'Adult 1', weightLb: weightPlaceholder(170) },
    { id: 'adult2', label: 'Adult 2', weightLb: weightPlaceholder(170) },
    { id: 'toddler', label: 'Toddler', weightLb: weightPlaceholder(30) },
  ],
  waterGal: 12,
  extraFuelGal: 0,
  otherLb: 0,
  towing: false,
  includeWishlist: true,
});

const powerProfileSeed: SeedRecord = seed('power_profile', 'power_profile:default', {
  batteryName: 'EcoFlow Delta 3 Plus',
  batteryWh: { value: 1024, status: 'verify' },
  usablePct: { value: 90, status: 'estimate', note: 'inverter/DC losses — adjust' },
  startPct: 100,
  loads: [
    {
      id: 'fridge',
      name: 'ICECO VL45 fridge',
      enabled: true,
      whPerDay: 350,
      watts: null,
      hoursPerDay: null,
      note: 'lab figure; higher in heat',
    },
    {
      id: 'fan-lights-phone',
      name: 'Fan, lights & phone charging',
      enabled: true,
      whPerDay: 100,
      watts: null,
      hoursPerDay: null,
      note: 'typically 50–150 Wh/night',
    },
    {
      id: 'small-ac',
      name: 'Small AC (BougeRV PC35)',
      enabled: false,
      whPerDay: null,
      watts: 400,
      hoursPerDay: 4,
      note: '',
    },
  ],
  solar: { enabled: true, panelW: 200, peakSunHours: 4, efficiencyPct: 72 },
  driveCharge: { watts: 300, hoursPerDay: 0 },
  tripDays: 3,
});

/** Phase 1 starting data: gear + budgets, checklist templates, calculator profiles. */
export const gearSeeds: SeedRecord[] = [
  ...categorySeeds,
  ...gearItemSeeds,
  ...checklistSeeds,
  loadProfileSeed,
  powerProfileSeed,
];
