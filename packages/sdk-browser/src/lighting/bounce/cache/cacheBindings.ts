import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { atlasEntry } from '../atlas.ts'
import { skyLightReadLayoutEntries } from '../../../modules/sky/skyLight/read.ts'
import { surfaceHitBindingsFrom, surfaceHitLayoutEntries } from '../../surfaceCache/hitWgsl.ts'
import { RADIANCE_CACHE_FORMATS as F } from './cacheLayout.ts'

/** The bindings of the kernel that makes the trace tiles of the probes the frame queued (`cacheTilesWgsl.ts`): the levels' uniform,
 *  the cell table, the queue, the cache's parameters, the importance functions (read, written by the clear) and the list of the
 *  tiles. */
export const CACHE_TILES_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  pdf: 4,
  tiles: 5,
} as const

/** The layout of the tiles' kernel. */
export const cacheTilesEntries = () => {
  const B = CACHE_TILES_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.table),
    computeBufferEntry(B.queue, 'read-only-storage'),
    computeUniformEntry(B.params),
    computeBufferEntry(B.pdf, 'storage'),
    computeBufferEntry(B.tiles, 'storage'),
  ]
}

/** The bindings of the kernel that traces the tiles (`cacheTraceWgsl.ts`): the levels' uniform, the lights, the queue, the cell table,
 *  the sky light (the cubes its rays that leave the scene reach the sky by, and the harmonics' uniform), the tile list, the raw atlas
 *  written and the cache's parameters; and, from 22, what its rays' hits read (`CACHE_TRACE_HIT`). */
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

/** The layout of the trace kernel. */
export const cacheTraceEntries = () => {
  const B = CACHE_TRACE_BINDINGS
  return [
    computeUniformEntry(B.grid),
    computeBufferEntry(B.lights, 'read-only-storage'),
    computeBufferEntry(B.queue, 'read-only-storage'),
    atlasEntry(B.table),
    computeBufferEntry(B.tiles, 'read-only-storage'),
    computeStorageTextureEntry(B.raw, F.raw),
    computeUniformEntry(B.params),
    ...skyLightReadLayoutEntries(CACHE_TRACE_SKY_LIGHT, COMPUTE),
    ...surfaceHitLayoutEntries(CACHE_TRACE_HIT),
  ]
}

/** The bindings of the kernel that filters the maps (`cacheFilterWgsl.ts`): the levels' uniform, the cell table, the queue, the
 *  cache's parameters, the raw atlas, the final atlas written, the tags and the sky's share written. */
export const CACHE_FILTER_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  raw: 4,
  final: 5,
  tags: 6,
  sky: 7,
} as const

/** The layout of the filter kernel. */
export const cacheFilterEntries = () => {
  const B = CACHE_FILTER_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.table),
    computeBufferEntry(B.queue, 'read-only-storage'),
    computeUniformEntry(B.params),
    computeTextureEntry(B.raw, 'uint'),
    computeStorageTextureEntry(B.final, F.final),
    computeBufferEntry(B.tags, 'storage'),
    computeStorageTextureEntry(B.sky, F.sky),
  ]
}

/** The bindings of the kernel that makes a level of detail of the final maps from the one above (`cacheMipsWgsl.ts`): the levels'
 *  uniform, the cell table, the queue, the cache's parameters, the level above, read, and the level made, written. */
export const CACHE_MIPS_BINDINGS = {
  grid: 0,
  table: 1,
  queue: 2,
  params: 3,
  above: 4,
  below: 5,
} as const

/** The layout of the levels' kernel. */
export const cacheMipsEntries = () => {
  const B = CACHE_MIPS_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.table),
    computeBufferEntry(B.queue, 'read-only-storage'),
    computeUniformEntry(B.params),
    computeTextureEntry(B.above, 'uint'),
    computeStorageTextureEntry(B.below, F.final),
  ]
}
