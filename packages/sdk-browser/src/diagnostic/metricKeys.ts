import type { FrameMetrics } from '../../../sdk-core/src/index.ts'

/**
 * The measurements an engine publishes as-is and the host copies one by one, `null` when that
 * engine does not hold them. The list IS the contract: the type `metrics()` returns derives from
 * it, so a measurement added here is copied without a second list having to be written by hand.
 */
export const ENGINE_METRIC_KEYS = [
  'rafIntervalMs',
  'displayRefreshMs',
  'renderWidth',
  'renderHeight',
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
  'cpuSelectNodesTested',
  'cpuSubmitMs',
  'gpuPassMs',
  'gpuFrameMs',
  'gpuHostGapMs',
  'gpuIdleMs',
  'gpuDeviceLost',
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
  'texturePoolFormat',
  'texturePoolLayers',
  'textureTilesResident',
  'textureResidentBytes',
  'textureTilesRequested',
  'textureTilesAtLevel',
  'textureMissingLevels',
  'textureTilesPending',
  'textureTilesDeferred',
  'textureTilesServed',
  'textureTilesEvicted',
  'textureTilesRefused',
  'textureBytesLastFrame',
  'textureUploadMs',
  'textureUploadPeakMs',
  'textureLevelReads',
  'textureLevelsDecoded',
  'textureLevelCacheBytes',
  'textureScratchBuilds',
  'textureLiveBytes',
  'lightsActive',
  'lightsSampled',
  'shadowVsmLights',
  'shadowVsmMaps',
  'shadowVsmPagesRequested',
  'shadowVsmPagesAllocated',
  'shadowVsmPagesCached',
  'shadowVsmPagesRendered',
  'shadowVsmFreePages',
  'shadowVsmLodBias',
  'shadowVsmProjectionPasses',
  'shadowVsmInvalidationMs',
  'shadowVsmMarkingMs',
  'shadowVsmPageManagementMs',
  'shadowVsmRenderMs',
  'shadowVsmProjectionMs',
  'shadowVsmTransmissionMs',
  'shadowPoolBytes',
  'shadowResolutionBias',
  'gpuLightListsMs',
  'tileLightPoolReserved',
  'tileLightPoolCapacity',
  'tileLightPoolOverflowed',
  'tileLightPoolGrowths',
  'gpuShadowsMs',
  'gpuShadowCullMs',
  'gpuShadowRasterMs',
  'gpuLightingMs',
] as const

/** Measurements the engine publishes of every frame beside the host's own counters: `null`
 *  while unmeasured, never absent. */
type HeldMetric = 'clusters' | 'selectedTriangles' | 'residentPages' | 'geometryAllocationBytes'

/** Measurements the host composes when the engine leaves them out: from its stream, or from
 *  their parts. */
type ComposedMetric = 'cacheEvictions' | 'totalSubmittedTriangles'

/** What an engine publishes of its frame: the measurements copied as-is, those it always holds,
 *  and those the host composes. */
export type EngineMetrics = Pick<FrameMetrics, HeldMetric> &
  Partial<Pick<FrameMetrics, (typeof ENGINE_METRIC_KEYS)[number] | ComposedMetric>>
/** Draw counters an engine adds to its metrics. */
export type EngineDrawCounters = {
  drawCalls: number
}
