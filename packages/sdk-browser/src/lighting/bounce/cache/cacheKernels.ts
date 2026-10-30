import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
} from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { buildComputeStage, startedComputeStages } from '../../../gpu/core/computeStages.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import {
  cacheFilterEntries,
  cacheFixupEntries,
  cacheSplatEntries,
  cacheTilesEntries,
  cacheTraceEntries,
  cacheTracedLayouts,
} from './cacheBindings.ts'
import { cacheFilterProgram } from './cacheFilterWgsl.ts'
import { cacheFixupProgram } from './cacheFixupWgsl.ts'
import { CACHE_TILES_PROGRAM } from './cacheTilesWgsl.ts'
import { cacheSplatProgramOf, cacheTraceProgramOf, cacheTracedProgramOf } from './cacheTraceWgsl.ts'

/** The entry the trace kernel of either way of casting the rays runs. */
export const TRACE_ENTRY = 'traceTiles'

/** One module of the cache's kernels: its layout, and a pipeline for each entry it asks (with the pipeline constants of its own; the
 *  dispatch width of the device, where the module holds a list — `listed` — and the device's is not WebGPU's guaranteed one). */
async function stage(
  device: GPUDevice,
  code: string,
  label: string,
  entries: GPUBindGroupLayoutEntry[],
  points: readonly (readonly [string, Record<string, number>?])[],
  listed = false,
) {
  const constants = listed ? groupWidthConstants(groupWidth(device.limits)) : undefined
  const module = await createCheckedShaderModule(device, code, label)
  const layout = device.createBindGroupLayout({ label: `Trillion3D ${label}`, entries })
  const pipelines = await Promise.all(
    points.map(([point, own]) =>
      buildComputeStage(device, [layout], module, point, { ...constants, ...own }),
    ),
  )
  return { layout, pipelines }
}

/** The pipelines of the kernels that do not touch the light — the tiles —, and the layouts of their groups: made once for a
 *  device, whatever the maps' shape and the caches that run them. */
const createSharedKernels = oncePerDevice(async (device: GPUDevice) => {
  const [tiles] = await Promise.all([
    stage(
      device,
      CACHE_TILES_PROGRAM,
      'CACHE_TILES',
      cacheTilesEntries(),
      [['generateTiles'], ['advanceSlice'], ['sortTiles'], ['clearLobes'], ['generateLobeTiles']],
      true,
    ),
  ])
  return {
    tiles: {
      layout: tiles.layout,
      generateTiles: tiles.pipelines[0],
      /** The move to the next slice of the tile list, between the passes of a full update's trace. */
      advanceSlice: tiles.pipelines[1],
      /** The tiles of the list ordered by the direction they trace (`screenProbeRadianceCacheSortTraceTiles`). */
      sortTiles: tiles.pipelines[2],
      /** The lobes the screen probes want light in set to nothing, before they add theirs. */
      clearLobes: tiles.pipelines[3],
      /** The tiles cut by those lobes (`screenProbeRadianceCacheTraceTiles` automatic). */
      generateLobeTiles: tiles.pipelines[4],
    },
  }
})

/** The pipelines of the kernels that write or read the light — the trace, which reads the surface cache's final light stored in the same format, the spread, the filter and the fixup —, and
 *  their layouts, for maps stored in the format `light`. */
async function createLightKernels(device: GPUDevice, light: LightAtlasFormat) {
  const [trace, splat, filter, fixup] = await Promise.all([
    stage(
      device,
      cacheTraceProgramOf(light),
      'CACHE_TRACE',
      cacheTraceEntries(light),
      [[TRACE_ENTRY]],
      true,
    ),
    stage(
      device,
      cacheSplatProgramOf(light),
      'CACHE_SPLAT',
      cacheSplatEntries(light),
      [['spreadTiles']],
      true,
    ),
    stage(device, cacheFilterProgram(light), 'CACHE_FILTER', cacheFilterEntries(light), [
      ['filterMaps'],
    ]),
    stage(device, cacheFixupProgram(light), 'CACHE_FIXUP', cacheFixupEntries(light), [
      ['fixupMaps'],
    ]),
  ])
  return {
    trace: { layout: trace.layout, traceTiles: trace.pipelines[0] },
    /** The spread of the trace atlas into the raw atlas, after the trace through the scene's triangles. */
    splat: { layout: splat.layout, spreadTiles: splat.pipelines[0] },
    filter: { layout: filter.layout, filterMaps: filter.pipelines[0] },
    /** The copy of the filtered maps to the final atlas, with their border and levels of detail. */
    fixup: { layout: fixup.layout, fixupMaps: fixup.pipelines[0] },
  }
}

/** The light's kernels, memoised by device and format. */
const lightKernels = oncePerDeviceKey(createLightKernels)

/** The pipelines of the cache's kernels and the layouts of their groups for maps stored in the format `light`: those that write or read the light made once for a
 *  device and a format, the others once for a device, whatever the maps' shape and the caches that run them. */
export async function createCacheKernels(device: GPUDevice, light: LightAtlasFormat) {
  const [shared, written] = await Promise.all([
    createSharedKernels(device),
    lightKernels(device, light),
  ])
  return { ...shared, ...written }
}

/**
 * A trace that casts rays through the scene's triangles, compiled off the frame and not waited for: its `layouts` (a group each, in the order
 * of the groups), the `entry` of `code` it runs, and its pipeline, read once `ready`. `hitLit` says it marks its hits for the hit lighting in the second
 * texture of the trace atlas (`TraceAtlas.marks`): the group it is bound with names that texture, and no other kernel's does.
 */
export function startedTracedKernel(
  device: GPUDevice,
  label: string,
  layouts: readonly GPUBindGroupLayout[],
  code: string,
  entry: string,
  hitLit = false,
) {
  const stages = startedComputeStages(
    device,
    label,
    device.createPipelineLayout({ bindGroupLayouts: layouts }),
    device.createShaderModule({ label, code }),
    [entry],
    groupWidthConstants(groupWidth(device.limits)),
  )
  return {
    layouts,
    hitLit,
    get ready() {
      return stages.ready
    },
    get pending() {
      return stages.pending
    },
    /** The compiled trace: read once `ready`. */
    pipeline: () => stages.pipelineOf(entry),
  }
}

/**
 * The trace that casts the rays through the scene's triangles (`cacheTracedProgramOf`), made once for the device and the format `light` the maps are stored in (the surface
 * cache's final light is read in the same) when a scene has acceleration structures and the cache's rays are traced: compiled off the frame, not waited for by the cache's own
 * kernels — until it is `ready` the rays are marched through the field. Its layouts are the cache's own group with the cut's tables, and the scene trace's.
 */
export const tracedCacheKernels = oncePerDeviceOverPrograms(
  (device: GPUDevice, light: LightAtlasFormat, programs) =>
    startedTracedKernel(
      device,
      `Trillion3D CACHE_TRACED ${light}|${sceneMaskKey(programs)}`,
      cacheTracedLayouts(light).map((entries, at) =>
        device.createBindGroupLayout({ label: `Trillion3D CACHE_TRACED group ${at}`, entries }),
      ),
      cacheTracedProgramOf(light, programs),
      TRACE_ENTRY,
    ),
)

/** The maker of the traced trace for a device and a format, as the mask hold takes it (`maskHold.use`): one function each, not one an image. */
export const tracedCacheMaker = heldMakerOf(tracedCacheKernels)

/** The traced trace's kernels, made. */
export type TracedCacheKernels = ReturnType<typeof tracedCacheKernels>

/** The cache's kernels for one format, made. */
export type CacheKernels = Awaited<ReturnType<typeof createCacheKernels>>
