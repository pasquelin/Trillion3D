import type { FrameMetrics } from '../sdk-core/index.ts';

/**
 * Les mesures qu'un moteur publie telles quelles et que l'hôte recopie une à une, `null` quand ce
 * moteur ne les tient pas. La liste EST le contrat : le type que `metrics()` rend en dérive, si bien
 * qu'une mesure ajoutée ici est recopiée sans qu'une seconde liste ait à être écrite à la main.
 */
export const BACKEND_METRIC_KEYS = [
  'coverageReady',
  'coverageBudgetLimited',
  'uncoveredTriangles',
  'drawnTriangles',
  'pagesDetached',
  'frustumRejected',
  'hizTestedClusters',
  'hizRejectedClusters',
  'hizOversizedClusters',
  'hizTestedTriangles',
  'hizRejectedTriangles',
  'hizOversizedTriangles',
  'hizCountedFrame',
  'lodLevel',
  'frameHeld',
  'submittedTriangles',
  'transparentMeshes',
  'transparentFrustumRejected',
  'transparentDrawCalls',
  'transparentSubmittedTriangles',
  'cpuSelectMs',
  'gpuSelectionFallback',
  'cpuSelectNodesTested',
  'cpuSubmitMs',
  'gpuMs',
  'gpuPassMs',
  'gpuFrameMs',
  'gpuHostGapMs',
  'vramBytes',
  'gpuAllocatedBytes',
  'gpuAllocatedByLabel',
  'gpuAllocationsUnknownFormat',
  'gpuFrameTargetBytes',
  'geometryPoolBytes',
  'geometryPoolSlots',
  'geometryPoolAllocatedBytes',
  'geometryPoolClamp',
  'geometryPoolSaturated',
  'texturePoolClamp',
  'texturePoolBytes',
  'texturePoolLayers',
  'textureTilesResident',
  'textureResidentBytes',
  'textureTilesRequested',
  'textureTilesAtLevel',
  'textureMissingLevels',
  'textureTilesPending',
  'textureTilesServed',
  'textureTilesEvicted',
  'textureTilesRefused',
  'textureBytesLastFrame',
  'textureLevelReads',
  'textureLevelsDecoded',
  'textureLevelCacheBytes',
  'textureScratchBuilds',
  'lightsActive',
  'shadowsUpdated',
  'shadowFacesDrawn',
  'shadowDrawCalls',
  'shadowPagesDrawn',
  'shadowPagesPending',
  'shadowWaitMs',
  'gpuLightListsMs',
  'gpuShadowsMs',
  'gpuLightingMs',
] as const;

/** Les mesures que l'hôte compose lui-même, à partir du moteur et de ses propres compteurs. */
type ComposedMetric =
  | 'clusters'
  | 'selectedTriangles'
  | 'residentPages'
  | 'geometryAllocationBytes'
  | 'cacheEvictions'
  | 'totalSubmittedTriangles';

/** Ce qu'un moteur publie de son image : les mesures recopiées telles quelles, et celles que
 *  l'hôte compose. */
export type BackendMetrics = Partial<
  Pick<FrameMetrics, (typeof BACKEND_METRIC_KEYS)[number] | ComposedMetric>
>;
