export type { HizPage, HizBounds, HizPyramid } from './hizTypes.ts';
export { buildHizPyramid, visibilityDepth } from './hizDepth.ts';
export { HIZ_BOUNDS_VALUES, createBoxCorners } from './hizCorners.ts';
export { projectBoxesFlat, projectBoxToScreen } from './hizProjection.ts';
export {
  HIZ_TEST_VALUES,
  hizTestRectFlat,
  hizRejects,
  filterUnoccluded,
  countUnoccluded,
} from './hizOcclusion.ts';
export { createHizCounts, resetHizCounts, hizOversizedFlat } from './hizCounts.ts';
export type { HizCounts } from './hizCounts.ts';
export { splitOccludersFlat, splitOccluders } from './hizSplit.ts';
export { sameHizView, applyTemporalHiz } from './hizTemporal.ts';
export type { TemporalHizState } from './hizTemporal.ts';
