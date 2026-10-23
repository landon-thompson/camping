// Lake recommender engine (docs/LAKE_RECS_PLAN.md §4). The contract lives in types.ts.
export type * from './types';

// Contract (types.ts)
export { useLakeRecs } from './useLakeRecs';
export { useLakeModelStatus } from './useLakeModelStatus';
export { saveFishingLog } from './saveFishingLog';
export { recommendLakes } from './rank';
export { DEFAULT_WEIGHTS } from './weights';

// Extras for the UI and the app shell
export { startLakeModelRefresh } from './refresh';
export { ensureTilesFor, refreshLakeModel, modelStatus, loadTiles, tilesFor } from './modelStore';
export { rangeText, sourceLinks, fmtPoints, kmToMi } from './explain';
export type { LakeRecWeights, Weight, SeasonRow } from './weights';
export type { RecData, RecOptions } from './rank';
