// Test-only loader for the synthetic fixtures (regenerate with generate.mjs).
// Raw text is kept so tests can serve the exact bytes the sha256 covers.
import manifestRaw from './manifest.json?raw';
import eastRaw from './tiles/t_47.5_-92.json?raw';
import westRaw from './tiles/t_47.5_-93.json?raw';
import type { ModelManifest, ModelTile } from '../types';

export const FIXTURE_RAW: Record<string, string> = {
  'manifest.json': manifestRaw,
  'tiles/t_47.5_-92.json': eastRaw,
  'tiles/t_47.5_-93.json': westRaw,
};

export const fixtureManifest = (): ModelManifest => JSON.parse(manifestRaw) as ModelManifest;
export const fixtureTiles = (): ModelTile[] => [JSON.parse(eastRaw) as ModelTile, JSON.parse(westRaw) as ModelTile];

/** Near Ely, MN: the campsite every engine test starts from. */
export const FIXTURE_ORIGIN = { lat: 47.9, lng: -91.87 };
