import type { BudgetCategory, Gear, GearLocation, TripKind } from '../../model/schemas';

/**
 * Gear from the planning brief. Prices are rough research estimates (editable).
 * Weights are left blank unless the brief gave one — enter real weights as you
 * get them; the load calculator lists anything still missing.
 */

export const CATEGORIES: { key: string; data: BudgetCategory }[] = [
  // Starting allocations = mid-point of the priced items in each category,
  // rounded. Categories at $0 have items with no price yet.
  { key: 'power', data: { name: 'Power & fridge', budgetUsd: 1500, order: 1 } },
  { key: 'roof', data: { name: 'Roof', budgetUsd: 600, order: 2 } },
  { key: 'lighting', data: { name: 'Lighting', budgetUsd: 200, order: 3 } },
  { key: 'kitchen', data: { name: 'Kitchen', budgetUsd: 300, order: 4 } },
  { key: 'shelter', data: { name: 'Shelter & comfort', budgetUsd: 350, order: 5 } },
  { key: 'toddler', data: { name: 'Toddler', budgetUsd: 0, order: 6 } },
  { key: 'offgrid', data: { name: 'Off-grid finale', budgetUsd: 0, order: 7 } },
];

export const categoryId = (key: string) => `budget_category:${key}`;

interface G {
  key: string;
  name: string;
  cat: string;
  priority?: number;
  cost?: [number, number];
  weight?: number;
  loc: GearLocation | null;
  packFor: TripKind[];
  status?: Gear['status'];
  inBudget?: boolean;
  optional?: boolean;
  quantity?: number;
  powerW?: number;
  whPerDay?: number;
  notes?: string;
  verify?: string;
}

const ITEMS: G[] = [
  // Power & fridge
  { key: 'iceco-vl45', name: 'ICECO VL45 fridge (Secop compressor)', cat: 'power', priority: 1, cost: [475, 475], loc: 'cargo', packFor: ['all'], whPerDay: 350, notes: '~$475 on sale. ~350 Wh/day (lab figure; higher in heat).' },
  { key: 'ecoflow-delta-3-plus', name: 'EcoFlow Delta 3 Plus (1,024 Wh)', cat: 'power', priority: 1, cost: [550, 900], loc: 'cargo', packFor: ['no-hookup', 'off-grid'], notes: 'Buy on a holiday sale. Set AC charge limit ~300 W when charging from the GX cargo outlet (400 W max, off with ignition).' },
  { key: 'solar-200w', name: '200 W folding solar panel + MC4-to-XT60 adapter', cat: 'power', priority: 5, cost: [200, 400], loc: 'cargo', packFor: ['no-hookup', 'off-grid'] },
  { key: 'fridge-straps', name: 'Fridge tie-down straps', cat: 'power', loc: 'cargo', packFor: ['all'] },
  { key: 'iceco-slide', name: 'ICECO fridge slide', cat: 'power', cost: [269, 269], loc: 'cargo', packFor: ['all'], optional: true, notes: 'Optional.' },
  // Roof
  { key: 'thule-bars', name: 'Thule WingBar Evo 127 cm (711320) + Evo Raised Rail feet (710405) + One-Key lock cores', cat: 'roof', priority: 2, loc: 'roof', packFor: ['all'], verify: 'Fit is based on the matching Land Cruiser 250 rails. Verify in Thule’s fit guide.' },
  { key: 'yakima-slimshady', name: 'Yakima SlimShady 6.5′ awning', cat: 'roof', priority: 3, cost: [389, 499], weight: 28, loc: 'roof', packFor: ['all'], notes: 'Alternatives: Rhino-Rack Sunseeker 2.0 (~22 lb); Kammok Crosswing (~$850–1,100, 38–45 lb).' },
  { key: 'cargo-bag', name: 'Soft cargo bag + non-slip roof mat', cat: 'roof', priority: 4, cost: [100, 250], loc: 'roof', packFor: ['all'] },
  // Lighting
  { key: 'liftgate-lamp', name: 'Plug-in liftgate lamp, warm white', cat: 'lighting', cost: [30, 60], loc: 'cargo', packFor: ['all'], verify: 'Verify GX550 fit.' },
  { key: 'scene-pods', name: 'Rear scene LED pod(s) on an aux switch', cat: 'lighting', cost: [50, 200], loc: 'mounted', packFor: ['all'] },
  { key: 'awning-led', name: 'Awning LED strip (USB/12 V from EcoFlow)', cat: 'lighting', cost: [30, 80], loc: 'roof', packFor: ['all'] },
  // Kitchen
  { key: 'everest-2x', name: 'Camp Chef Everest 2X stove', cat: 'kitchen', cost: [190, 230], loc: 'cargo', packFor: ['all'] },
  { key: 'fg20-griddle', name: 'Camp Chef FG20 griddle', cat: 'kitchen', loc: 'cargo', packFor: ['all'] },
  { key: 'propane', name: 'Propane adapter hose + refillable tank', cat: 'kitchen', loc: 'cargo', packFor: ['all'] },
  { key: 'roll-table', name: 'Large adjustable roll-top table (~47 × 24 in)', cat: 'kitchen', cost: [60, 120], loc: 'cargo', packFor: ['all'] },
  { key: 'kitchen-bin', name: 'Kitchen bin (cookware, utensils, plates, spices, soap)', cat: 'kitchen', loc: 'cargo', packFor: ['all'] },
  { key: 'water-jugs', name: 'Water jugs, 5–7 gal', cat: 'kitchen', quantity: 2, loc: 'cargo', packFor: ['all'], notes: 'Water weight is counted separately in the load calculator.' },
  { key: 'collapsible-sink', name: 'Collapsible sink', cat: 'kitchen', loc: 'cargo', packFor: ['all'] },
  { key: 'trash-bag', name: 'Hanging trash bag', cat: 'kitchen', loc: 'cargo', packFor: ['all'] },
  { key: 'kettle', name: 'Kettle', cat: 'kitchen', loc: 'cargo', packFor: ['all'] },
  // Shelter & comfort
  { key: 'core-6-cabin', name: 'CORE 6 Person Instant Cabin Tent with awning', cat: 'shelter', status: 'own', inBudget: false, loc: 'cargo', packFor: ['all'], notes: 'Has an electrical cord port. Marked as already owned; change it if that’s wrong.' },
  { key: 'tent-fan', name: 'Tent fan', cat: 'shelter', loc: 'cargo', packFor: ['all'] },
  { key: 'lantern', name: 'Dimmable lantern / string lights', cat: 'shelter', loc: 'cargo', packFor: ['all'] },
  { key: 'rug', name: 'Outdoor rug', cat: 'shelter', loc: 'cargo', packFor: ['all'] },
  { key: 'sunshade', name: 'Lightweight sunshade or tarp', cat: 'shelter', loc: 'cargo', packFor: ['all'] },
  { key: 'bougerv-pc35', name: 'BougeRV PC35 portable AC', cat: 'shelter', cost: [300, 400], loc: 'cargo', packFor: ['electric'], powerW: 400, notes: 'For hot electric-site trips. ~400 W.' },
  // Toddler
  { key: 'play-tent', name: 'Mesh pop-up play tent', cat: 'toddler', loc: 'cargo', packFor: ['toddler'] },
  { key: 'high-chair', name: 'Portable camp high chair', cat: 'toddler', loc: 'cargo', packFor: ['toddler'] },
  { key: 'head-nets', name: 'Head nets', cat: 'toddler', loc: 'cab', packFor: ['toddler'] },
  { key: 'child-first-aid', name: 'Child first-aid items', cat: 'toddler', loc: 'cab', packFor: ['toddler'] },
  { key: 'child-pfd', name: 'USCG-approved infant/child PFD', cat: 'toddler', loc: 'boat', packFor: ['boat', 'toddler'], verify: 'Check the fit and weight range for our child.' },
  // Off-grid finale
  { key: 'sat-messenger', name: 'Satellite messenger (e.g. Garmin inReach) or phone satellite SOS', cat: 'offgrid', loc: 'cab', packFor: ['off-grid'] },
  { key: 'traction-boards', name: 'Traction boards', cat: 'offgrid', loc: 'cargo', packFor: ['off-grid'] },
  { key: 'recovery-strap', name: 'Recovery strap', cat: 'offgrid', loc: 'cargo', packFor: ['off-grid'] },
  { key: 'shovel', name: 'Shovel', cat: 'offgrid', loc: 'cargo', packFor: ['off-grid'] },
  { key: 'folding-saw', name: 'Folding saw', cat: 'offgrid', loc: 'cargo', packFor: ['off-grid'], notes: 'Fallen trees are common on forest roads.' },
  { key: 'onx-offroad', name: 'onX Offroad subscription (offline maps)', cat: 'offgrid', loc: null, packFor: ['off-grid'] },
];

export const GEAR: { id: string; data: Gear }[] = ITEMS.map((g) => ({
  id: `gear:${g.key}`,
  data: {
    name: g.name,
    categoryId: categoryId(g.cat),
    status: g.status ?? 'wishlist',
    priority: g.priority ?? null,
    quantity: g.quantity ?? 1,
    costLowUsd: g.cost?.[0] ?? null,
    costHighUsd: g.cost?.[1] ?? null,
    costActualUsd: null,
    inBudget: g.inBudget ?? true,
    optional: g.optional ?? false,
    weightLb:
      g.weight !== undefined
        ? { value: g.weight, status: 'verify', source: 'Planning brief (approx.)' }
        : { value: null, status: 'estimate' },
    powerW: g.powerW ?? null,
    energyWhPerDay: g.whPerDay ?? null,
    location: g.loc,
    packFor: g.packFor,
    notes: g.notes ?? '',
    verify: g.verify ?? '',
  },
}));
