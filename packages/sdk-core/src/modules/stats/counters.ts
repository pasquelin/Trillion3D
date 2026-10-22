import type { FrameMetrics } from '../../contracts/metrics.ts'

/** How a figure is shown: a time, a size, a count, or a share of a second in percent. */
export type StatsUnitKind = 'ms' | 'MiB' | 'count' | '%'

/** The tabs of the panel, in their fixed order; `page` (all the page's worlds and views) comes
 *  first and exists only on a page of several worlds or views. */
export const STATS_TABS = ['page', 'gpu', 'cpu', 'shadows', 'memory', 'scene'] as const
export type StatsTab = (typeof STATS_TABS)[number]

/**
 * The counters of the frame the stats report shows beside the GPU and CPU stages, in display order:
 * the shadow passes' times then the shadow counts, the memory kinds, the scene's figures. `field`
 * is the frame metric it reads, `key` its `words.ts` key, `tab` the section it belongs to and
 * `unit` how it is shown (`MiB` for a size kept in bytes). The scene's light count
 * (`lightsActive`) is its own, apart from the shadowed lights' (`shadowVsmLights`), and the shadow
 * pool's bytes are the memory's.
 */
export const STATS_COUNTERS = [
  { field: 'shadowVsmInvalidationMs', key: 'shadows.invalidation', tab: 'shadows', unit: 'ms' },
  { field: 'shadowVsmMarkingMs', key: 'shadows.marking', tab: 'shadows', unit: 'ms' },
  { field: 'shadowVsmPageManagementMs', key: 'shadows.pageManagement', tab: 'shadows', unit: 'ms' },
  { field: 'shadowVsmRenderMs', key: 'shadows.render', tab: 'shadows', unit: 'ms' },
  { field: 'shadowVsmProjectionMs', key: 'shadows.projection', tab: 'shadows', unit: 'ms' },
  { field: 'shadowVsmTransmissionMs', key: 'shadows.transmission', tab: 'shadows', unit: 'ms' },
  { field: 'shadowVsmLights', key: 'shadows.lights', tab: 'shadows', unit: 'count' },
  { field: 'shadowVsmMaps', key: 'shadows.maps', tab: 'shadows', unit: 'count' },
  {
    field: 'shadowVsmPagesRequested',
    key: 'shadows.pagesRequested',
    tab: 'shadows',
    unit: 'count',
  },
  {
    field: 'shadowVsmPagesAllocated',
    key: 'shadows.pagesAllocated',
    tab: 'shadows',
    unit: 'count',
  },
  { field: 'shadowVsmPagesCached', key: 'shadows.pagesCached', tab: 'shadows', unit: 'count' },
  { field: 'shadowVsmPagesRendered', key: 'shadows.pagesRendered', tab: 'shadows', unit: 'count' },
  { field: 'shadowVsmFreePages', key: 'shadows.freePages', tab: 'shadows', unit: 'count' },
  { field: 'shadowVsmLodBias', key: 'shadows.lodBias', tab: 'shadows', unit: 'count' },
  {
    field: 'shadowVsmProjectionPasses',
    key: 'shadows.projectionPasses',
    tab: 'shadows',
    unit: 'count',
  },
  { field: 'shadowResolutionBias', key: 'shadows.resolutionBias', tab: 'shadows', unit: 'count' },
  { field: 'gpuFrameTargetBytes', key: 'memory.screen', tab: 'memory', unit: 'MiB' },
  { field: 'shadowPoolBytes', key: 'memory.shadows', tab: 'memory', unit: 'MiB' },
  { field: 'geometryPoolBytes', key: 'memory.geometry', tab: 'memory', unit: 'MiB' },
  { field: 'texturePoolBytes', key: 'memory.textures', tab: 'memory', unit: 'MiB' },
  { field: 'textureLiveBytes', key: 'memory.liveTextures', tab: 'memory', unit: 'MiB' },
  { field: 'selectedTriangles', key: 'scene.trianglesSelected', tab: 'scene', unit: 'count' },
  { field: 'drawnTriangles', key: 'scene.trianglesDrawn', tab: 'scene', unit: 'count' },
  { field: 'drawCalls', key: 'scene.drawCalls', tab: 'scene', unit: 'count' },
  { field: 'residentPages', key: 'scene.geometryPages', tab: 'scene', unit: 'count' },
  { field: 'geometryPoolAllocatedBytes', key: 'scene.poolUsed', tab: 'scene', unit: 'MiB' },
  { field: 'geometryPoolBytes', key: 'scene.poolCapacity', tab: 'scene', unit: 'MiB' },
  { field: 'lightsActive', key: 'scene.lights', tab: 'scene', unit: 'count' },
] as const satisfies readonly {
  field: keyof FrameMetrics
  key: string
  tab: StatsTab
  unit: StatsUnitKind
}[]

/** The shadow counters that are times: the fields the collector files with each GPU sample. */
export const SHADOW_TIME_COUNTERS = STATS_COUNTERS.filter(
  (counter) => counter.tab === 'shadows' && counter.unit === 'ms',
)

/** The shadow counters that are counts, shown after the times. */
export const SHADOW_COUNTS = STATS_COUNTERS.filter(
  (counter) => counter.tab === 'shadows' && counter.unit !== 'ms',
)

/** The memory section's kinds. */
export const MEMORY_KINDS = STATS_COUNTERS.filter((counter) => counter.tab === 'memory')

/** The scene section's figures. */
export const SCENE_ROWS = STATS_COUNTERS.filter((counter) => counter.tab === 'scene')
