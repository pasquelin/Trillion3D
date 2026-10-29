import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { atlasEntry } from '../atlas.ts'
import { skyLightReadLayoutEntries } from '../../../modules/sky/skyLight/read.ts'
import { dagReadLayoutEntries } from '../../../geometry/dag/shader/bindings.ts'
import { sceneTraceLayoutEntries } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import {
  surfaceHitBindingsFrom,
  surfaceHitCardsLayoutEntries,
  surfaceHitLayoutEntries,
} from '../../surfaceCache/hitWgsl.ts'
import {
  WORD_LIGHT_FORMAT,
  lightAtlasSampleType,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'
import { radianceCacheFormats, radianceRawFormat, radianceCacheTempFormats } from './cacheLayout.ts'

/** The bindings of the kernel that makes the trace tiles of the probes the frame queued (`cacheTilesWgsl.ts`): the levels' uniform,
 *  the cell table, the queue, the cache's parameters, the list of the tiles and the lobes the screen probes want light in. */
export const CACHE_TILES_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  tiles: 4,
  pdf: 5,
} as const

/** The entries the cache's kernels start with: the grid, the cell table, the queue and the cache's parameters, under the kernel's bindings `B`. */
export const cacheKernelEntries = (B: {
  readonly grid: number
  readonly table: number
  readonly queue: number
  readonly params: number
}) => [
  computeUniformEntry(B.grid),
  atlasEntry(B.table),
  computeBufferEntry(B.queue, 'read-only-storage'),
  computeUniformEntry(B.params),
]

/** The layout of the tiles' kernel. */
export const cacheTilesEntries = () => {
  const B = CACHE_TILES_BINDINGS
  return [
    ...cacheKernelEntries(B),
    computeBufferEntry(B.tiles, 'storage'),
    computeBufferEntry(B.pdf, 'storage'),
  ]
}

/** The bindings of the kernel that traces the tiles (`cacheTraceWgsl.ts`): the levels' uniform, the lights, the queue, the cell table,
 *  the sky light (the cubes its rays that leave the scene reach the sky by, and the harmonics' uniform), the tile list, the atlas
 *  written — the raw atlas, or the trace atlas where the rays are cast through the scene's triangles — and the cache's parameters;
 *  and, from 22, what its rays' hits read (`CACHE_TRACE_HIT`). */
export const CACHE_TRACE_BINDINGS = {
  grid: 0,
  lights: 2,
  queue: 3,
  table: 4,
  skyCube: 11,
  skySampler: 12,
  skyHarmonics: 13,
  skyParams: 14,
  tiles: 19,
  raw: 20,
  params: 21,
} as const

/** Where the trace reads what its rays' hits find (`surfaceHitWgsl`): the global distance field, its object grid and the surface cache. */
export const CACHE_TRACE_HIT = surfaceHitBindingsFrom(0, 22)

/** Where the trace reads the sky light (`skyLightReadWgsl`). */
export const CACHE_TRACE_SKY_LIGHT = {
  group: 0,
  cube: CACHE_TRACE_BINDINGS.skyCube,
  sampler: CACHE_TRACE_BINDINGS.skySampler,
  harmonics: CACHE_TRACE_BINDINGS.skyHarmonics,
  params: CACHE_TRACE_BINDINGS.skyParams,
} as const

/** The layout of the trace kernel's first bindings, those of both its ways of casting the rays: all but what a hit reads. */
const cacheTraceBaseEntries = (light: LightAtlasFormat) => {
  const B = CACHE_TRACE_BINDINGS
  return [
    computeUniformEntry(B.grid),
    computeBufferEntry(B.lights, 'read-only-storage'),
    computeBufferEntry(B.queue, 'read-only-storage'),
    atlasEntry(B.table),
    computeBufferEntry(B.tiles, 'read-only-storage'),
    computeStorageTextureEntry(B.raw, radianceRawFormat(light)),
    computeUniformEntry(B.params),
    ...skyLightReadLayoutEntries(CACHE_TRACE_SKY_LIGHT, COMPUTE),
  ]
}

/** The layout of the trace kernel, the surface cache's final light read in the format `light`. */
export const cacheTraceEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => [
  ...cacheTraceBaseEntries(light),
  ...surfaceHitLayoutEntries(CACHE_TRACE_HIT, light),
]

/** Where the trace that casts its rays through the scene's triangles reads what a hit finds, from 22 (`probeRayTracedWgsl.ts`): the
 *  surface cache alone, the global field neither marched nor bound; the cut's tables it traces beside are at the culling's bindings
 *  (1, 6, 7 and 9), and the scene trace's own group is the second. */
export const CACHE_TRACED_HIT = { group: 0, cards: 22, instances: 30 } as const

/** The scene trace's group and its first binding in it. */
export const CACHE_TRACED_SCENE = { group: 1, first: 0 } as const

/** The layouts of the trace kernel that casts its rays through the scene's triangles: its own group, then the scene trace's; the surface cache's final light read in the format `light`. */
export const cacheTracedLayouts = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => [
  [
    ...cacheTraceBaseEntries(light),
    ...dagReadLayoutEntries(),
    ...surfaceHitCardsLayoutEntries(CACHE_TRACED_HIT, light),
  ],
  sceneTraceLayoutEntries(CACHE_TRACED_SCENE.first),
]

/** The bindings of the kernel that spreads the trace atlas into the raw atlas (`cacheTraceWgsl.ts`): the levels' uniform, the cell table,
 *  the queue, the cache's parameters, the tile list, the trace atlas and the raw atlas written. */
export const CACHE_SPLAT_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  tiles: 4,
  trace: 5,
  raw: 6,
} as const

/** The layout of the spread's kernel. */
export const cacheSplatEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => {
  const B = CACHE_SPLAT_BINDINGS
  return [
    ...cacheKernelEntries(B),
    computeBufferEntry(B.tiles, 'read-only-storage'),
    computeTextureEntry(B.trace, 'uint'),
    computeStorageTextureEntry(B.raw, radianceRawFormat(light)),
  ]
}

/** The bindings of the kernel that filters the maps (`cacheFilterWgsl.ts`): the levels' uniform, the cell table, the queue, the
 *  cache's parameters, the raw atlas, the filtered light and the filtered sky's share written, and the blue noise. */
export const CACHE_FILTER_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  raw: 4,
  filtered: 5,
  filteredSky: 6,
  noise: 7,
  /** The pool's slots, which hold the offsets the neighbours stand at. */
  slots: 8,
} as const

/** The layout of the filter kernel, its light written in the format `light` stores it in. */
export const cacheFilterEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => {
  const B = CACHE_FILTER_BINDINGS
  const T = radianceCacheTempFormats(light)
  return [
    ...cacheKernelEntries(B),
    computeTextureEntry(B.raw, 'uint'),
    computeStorageTextureEntry(B.filtered, T.filtered),
    computeStorageTextureEntry(B.filteredSky, T.filteredSky),
    computeTextureEntry(B.noise, 'float'),
    computeBufferEntry(B.slots, 'read-only-storage'),
  ]
}

/** The bindings of the kernel that fixes the borders of the final maps and makes their levels of detail (`cacheFixupWgsl.ts`): the levels'
 *  uniform, the cell table, the queue, the cache's parameters, the raw atlas, the filtered light and sky's share, the first three levels of
 *  detail of the final atlas written and its sky's share written. */
export const CACHE_FIXUP_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  raw: 4,
  filtered: 5,
  filteredSky: 6,
  final0: 7,
  final1: 8,
  final2: 9,
  sky: 10,
} as const

/** The layout of the fixup's kernel, the filtered light read and the final maps written in the format `light` stores it in. */
export const cacheFixupEntries = (light: LightAtlasFormat = WORD_LIGHT_FORMAT) => {
  const B = CACHE_FIXUP_BINDINGS
  const F = radianceCacheFormats(light)
  return [
    ...cacheKernelEntries(B),
    computeTextureEntry(B.raw, 'uint'),
    computeTextureEntry(B.filtered, lightAtlasSampleType(light)),
    computeTextureEntry(B.filteredSky, 'unfilterable-float'),
    computeStorageTextureEntry(B.final0, F.final),
    computeStorageTextureEntry(B.final1, F.final),
    computeStorageTextureEntry(B.final2, F.final),
    computeStorageTextureEntry(B.sky, F.sky),
  ]
}
