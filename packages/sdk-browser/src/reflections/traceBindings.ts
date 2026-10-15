import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../gpu/core/computeBindings.ts'
import { atlasEntry } from '../bounce/atlas.ts'
import { HDR_FORMAT } from '../scene/targetFormats.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { REFLECTION_GRID_FORMAT, REFLECTION_RAY_FORMAT } from './grids.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { REFLECTION_SIDE, REFLECTION_TILE_HEAD, REFLECTION_TILE_ROW } from './constants.ts'

/** The surface a kernel's pipeline works on — 0 the opaque, 1 the transparents' front
 *  (`frontLayer.ts`) —, given by the pipeline (`createTraceStages`): one entry a kernel, two
 *  pipelines, the same specialisation two entries made. */
export const REFLECTION_LAYER_WGSL = wgslBlock(
  'REFLECTION_LAYER_WGSL',
  [],
  'override REFLECTION_LAYER:u32;',
)

/**
 * THE ONE TABLE OF THE REFLECTIONS' GROUP 0, shared by the trace, the spatial reuse, the temporal
 * accumulation and the last pass (`trace.ts`): the WGSL declarations, the layouts and the entries read
 * their numbers here. A group serves one surface — the opaque one or the transparents' front one
 * (`frontLayer.ts`) — and one parity of the history's turn about (`traceGroups.ts`): its flags, normals
 * and lobes (its depth is the reflection group's), what a ray reads of the scene — the lights, the light
 * grid's world lists, the bounce cascades and their probes; the proxy is the reflection group's —, which
 * the trace reads, the grids each kernel reads or writes (`grids.ts`), and the
 * tiles the classification listed (`tiles.ts`), which every kernel runs over. The opaque last pass
 * writes the reflection target the resolve reads, the front one the radiance the forward fragments read.
 */
export const REFLECTION_TRACE_BINDINGS = {
  flags: 0,
  normals: 1,
  lobes: 2,
  lights: 3,
  lightLists: 4,
  bounceGrid: 5,
  probes: 6,
  traceOut: 10,
  raysOut: 11,
  spatialIn: 12,
  raysIn: 13,
  spatialOut: 14,
  temporalIn: 15,
  historyIn: 16,
  historyOut: 17,
  bilateralIn: 18,
  base: 19,
  target: 20,
  frontTarget: 21,
  tiles: 22,
} as const

const B = REFLECTION_TRACE_BINDINGS

/** The surface every kernel reads — its normals and lobes — and the tiles it runs over. */
const surface = () => [
  computeTextureEntry(B.normals, 'unfilterable-float'),
  computeTextureEntry(B.lobes, 'uint'),
  computeBufferEntry(B.tiles, 'read-only-storage'),
]

/** The surface's flags, which every kernel but the spatial reuse reads (`surfaceFlagsAt`, its lobes). */
const flags = () => computeTextureEntry(B.flags, 'uint')

/** What a ray reads of the scene here — the lights, the light grid's lists, the bounce cascades and
 *  their probes; the proxy is the reflection group's (`REFLECTION_SCENE_BINDINGS`). */
const scene = () => [
  computeBufferEntry(B.lights, 'read-only-storage'),
  computeBufferEntry(B.lightLists, 'read-only-storage'),
  computeBufferEntry(B.bounceGrid, 'uniform'),
  atlasEntry(B.probes),
]

/** The layouts of each kernel's group 0: the trace, the spatial reuse, the temporal accumulation, and
 *  the two last passes, each writing its surface's answer. */
export const traceLayouts = (device: GPUDevice) => {
  const layout = (entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ entries: [...surface(), ...entries] })
  return {
    trace: layout([
      flags(),
      ...scene(),
      computeStorageTextureEntry(B.traceOut, REFLECTION_GRID_FORMAT),
      computeStorageTextureEntry(B.raysOut, REFLECTION_RAY_FORMAT),
    ]),
    spatial: layout([
      computeTextureEntry(B.spatialIn, 'uint'),
      computeTextureEntry(B.raysIn, 'uint'),
      computeStorageTextureEntry(B.spatialOut, REFLECTION_GRID_FORMAT),
    ]),
    temporal: layout([
      flags(),
      computeTextureEntry(B.temporalIn, 'uint'),
      computeTextureEntry(B.historyIn, 'uint'),
      computeStorageTextureEntry(B.historyOut, REFLECTION_GRID_FORMAT),
    ]),
    bilateral: layout([
      flags(),
      computeTextureEntry(B.temporalIn, 'uint'),
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeTextureEntry(B.bilateralIn, 'uint'),
      computeTextureEntry(B.base, 'unfilterable-float'),
      computeStorageTextureEntry(B.target, HDR_FORMAT),
    ]),
    bilateralFront: layout([
      flags(),
      computeTextureEntry(B.temporalIn, 'uint'),
      computeTextureEntry(B.bilateralIn, 'uint'),
      computeStorageTextureEntry(B.frontTarget, FRONT_TRACED_FORMAT),
    ]),
  }
}

/** The tiles a kernel runs over (`tiles.ts`): the list the classification wrote — its head, the
 *  dispatch's rows of `REFLECTION_TILE_ROW` workgroups and the count, then a tile a word, x in the low
 *  half, y in the high —; `reflectionTileOf`, the tile of a workgroup, past the count none; and the
 *  pixel `reflectionTilePixel` a thread of it works on. */
export const REFLECTION_TILES_WGSL = wgslBlock(
  'REFLECTION_TILES_WGSL',
  [],
  `@group(0) @binding(${B.tiles}) var<storage,read> reflectionTiles:array<u32>;
fn reflectionTileOf(wg:vec3u)->u32{
 let at=wg.x+wg.y*${REFLECTION_TILE_ROW}u;
 if(at>=reflectionTiles[${REFLECTION_TILE_HEAD - 1}u]){return 0xffffffffu;}
 return reflectionTiles[${REFLECTION_TILE_HEAD}u+at];
}
fn reflectionTilePixel(wg:vec3u,local:vec3u)->vec2u{
 let t=reflectionTileOf(wg);
 return vec2u(t&0xffffu,t>>16u)*${REFLECTION_SIDE}u+local.xy;
}`,
)
