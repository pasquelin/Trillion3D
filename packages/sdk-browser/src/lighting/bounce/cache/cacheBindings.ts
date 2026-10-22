import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { atlasEntry } from '../atlas.ts'
import {
  PROBE_BINDINGS,
  PROBE_CLOUD_SHADOW,
  PROBE_PROXY,
  PROBE_SKY_LIGHT,
} from '../probes/probeBindings.ts'
import { cloudShadowLayoutEntries } from '../../atmosphere/cloudShadowRead.ts'
import { skyLightReadLayoutEntries } from '../../../modules/sky/skyLight/read.ts'
import { lightFunctionLayoutEntry } from '../../lightFunction/bindings.ts'
import { sceneLayoutEntries } from '../sceneBindings.ts'
import { RADIANCE_CACHE_FORMATS as F } from './cacheLayout.ts'

/** The bindings of the kernel that makes the trace tiles of the probes the frame queued (`cacheTilesWgsl.ts`): the levels' uniform,
 *  the probes' atlas, the queue, the cache's parameters, the importance functions (read, written by the clear), the list of the
 *  tiles and the flag of each queued probe that is traced. */
export const CACHE_TILES_BINDINGS = {
  grid: 0,
  probes: 1,
  queue: 2,
  params: 3,
  pdf: 4,
  tiles: 5,
  entries: 6,
} as const

/** The layout of the tiles' kernel. */
export const cacheTilesEntries = () => {
  const B = CACHE_TILES_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.probes),
    computeBufferEntry(B.queue, 'read-only-storage'),
    computeUniformEntry(B.params),
    computeBufferEntry(B.pdf, 'storage'),
    computeBufferEntry(B.tiles, 'storage'),
    computeBufferEntry(B.entries, 'storage'),
  ]
}

/** The bindings of the kernel that traces the tiles (`cacheTraceWgsl.ts`): the probe pass's own — the levels' uniform, the proxy,
 *  the lights, the queue, the probes' atlas, the world grid's light lists, the culling's worlds and the placement tree, the light
 *  functions' atlas, the sky light and the clouds' shade, at the probe pass's own numbers (`PROBE_BINDINGS`) — and the
 *  tile list, the raw atlas written and the cache's parameters, past them. */
export const CACHE_TRACE_BINDINGS = {
  grid: PROBE_BINDINGS.grid,
  proxy: PROBE_BINDINGS.proxy,
  lights: PROBE_BINDINGS.lights,
  queue: PROBE_BINDINGS.queue,
  probes: PROBE_BINDINGS.snapshot,
  lists: PROBE_BINDINGS.lists,
  worlds: PROBE_BINDINGS.worlds,
  tree: PROBE_BINDINGS.tree,
  lightFunction: PROBE_BINDINGS.lightFunction,
  tiles: 19,
  raw: 20,
  params: 21,
} as const

/** The layout of the trace kernel. */
export const cacheTraceEntries = () => {
  const B = CACHE_TRACE_BINDINGS
  return [
    computeUniformEntry(B.grid),
    computeBufferEntry(B.lights, 'read-only-storage'),
    computeBufferEntry(B.queue, 'read-only-storage'),
    atlasEntry(B.probes),
    computeBufferEntry(B.lists, 'read-only-storage'),
    computeBufferEntry(B.tiles, 'read-only-storage'),
    computeStorageTextureEntry(B.raw, F.raw),
    computeUniformEntry(B.params),
    ...sceneLayoutEntries(PROBE_PROXY),
    lightFunctionLayoutEntry(B.lightFunction),
    ...skyLightReadLayoutEntries(PROBE_SKY_LIGHT, COMPUTE),
    ...cloudShadowLayoutEntries(PROBE_CLOUD_SHADOW, COMPUTE),
  ]
}

/** The bindings of the kernel that filters the maps (`cacheFilterWgsl.ts`): the levels' uniform, the probes' atlas, the queue, the
 *  cache's parameters, the flags of the probes traced, the raw atlas, the final atlas written, the tags and the sky's share written. */
export const CACHE_FILTER_BINDINGS = {
  grid: 0,
  probes: 1,
  queue: 2,
  params: 3,
  entries: 4,
  raw: 5,
  final: 6,
  tags: 7,
  sky: 8,
} as const

/** The layout of the filter kernel. */
export const cacheFilterEntries = () => {
  const B = CACHE_FILTER_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.probes),
    computeBufferEntry(B.queue, 'read-only-storage'),
    computeUniformEntry(B.params),
    computeBufferEntry(B.entries, 'read-only-storage'),
    computeTextureEntry(B.raw, 'uint'),
    computeStorageTextureEntry(B.final, F.final),
    computeBufferEntry(B.tags, 'storage'),
    computeStorageTextureEntry(B.sky, F.sky),
  ]
}

/** The bindings of the kernel that makes a level of detail of the final maps from the one above (`cacheMipsWgsl.ts`): the levels'
 *  uniform, the probes' atlas, the queue, the cache's parameters, the flags of the probes traced, the level above, read, and the
 *  level made, written. */
export const CACHE_MIPS_BINDINGS = {
  grid: 0,
  probes: 1,
  queue: 2,
  params: 3,
  entries: 4,
  above: 5,
  below: 6,
} as const

/** The layout of the levels' kernel. */
export const cacheMipsEntries = () => {
  const B = CACHE_MIPS_BINDINGS
  return [
    computeUniformEntry(B.grid),
    atlasEntry(B.probes),
    computeBufferEntry(B.queue, 'read-only-storage'),
    computeUniformEntry(B.params),
    computeBufferEntry(B.entries, 'read-only-storage'),
    computeTextureEntry(B.above, 'uint'),
    computeStorageTextureEntry(B.below, F.final),
  ]
}
