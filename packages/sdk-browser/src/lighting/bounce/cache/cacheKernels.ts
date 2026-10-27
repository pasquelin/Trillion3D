import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { buildComputeStage, startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import {
  cacheFilterEntries,
  cacheFixupEntries,
  cacheSplatEntries,
  cacheTilesEntries,
  cacheTraceEntries,
  cacheTracedLayouts,
} from './cacheBindings.ts'
import { CACHE_FILTER_PROGRAM } from './cacheFilterWgsl.ts'
import { CACHE_FIXUP_PROGRAM } from './cacheFixupWgsl.ts'
import { CACHE_TILES_PROGRAM } from './cacheTilesWgsl.ts'
import { CACHE_SPLAT_PROGRAM, CACHE_TRACED_PROGRAM, CACHE_TRACE_PROGRAM } from './cacheTraceWgsl.ts'

/** The entry the trace kernel of either way of casting the rays runs. */
const TRACE_ENTRY = 'traceTiles'

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

/** The pipelines of the cache's kernels and the layouts of their groups: made once for a device, whatever the maps' shape and the caches
 *  that run them. */
export const createCacheKernels = oncePerDevice(async (device: GPUDevice) => {
  const [tiles, trace, splat, filter, fixup] = await Promise.all([
    stage(
      device,
      CACHE_TILES_PROGRAM,
      'CACHE_TILES',
      cacheTilesEntries(),
      [['generateTiles']],
      true,
    ),
    stage(device, CACHE_TRACE_PROGRAM, 'CACHE_TRACE', cacheTraceEntries(), [[TRACE_ENTRY]], true),
    stage(device, CACHE_SPLAT_PROGRAM, 'CACHE_SPLAT', cacheSplatEntries(), [['spreadTiles']], true),
    stage(device, CACHE_FILTER_PROGRAM, 'CACHE_FILTER', cacheFilterEntries(), [['filterMaps']]),
    stage(device, CACHE_FIXUP_PROGRAM, 'CACHE_FIXUP', cacheFixupEntries(), [['fixupMaps']]),
  ])
  return {
    tiles: { layout: tiles.layout, generateTiles: tiles.pipelines[0] },
    trace: { layout: trace.layout, traceTiles: trace.pipelines[0] },
    /** The spread of the trace atlas into the raw atlas, after the trace through the scene's triangles. */
    splat: { layout: splat.layout, spreadTiles: splat.pipelines[0] },
    filter: { layout: filter.layout, filterMaps: filter.pipelines[0] },
    /** The copy of the filtered maps to the final atlas, with their border and levels of detail. */
    fixup: { layout: fixup.layout, fixupMaps: fixup.pipelines[0] },
  }
})

/**
 * A trace that casts rays through the scene's triangles, compiled off the frame and not waited for: its `layouts` (a group each, in the order
 * of the groups), the `entry` of `code` it runs, and its pipeline, read once `ready`.
 */
export function startedTracedKernel(
  device: GPUDevice,
  label: string,
  layouts: readonly GPUBindGroupLayout[],
  code: string,
  entry: string,
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
    get ready() {
      return stages.ready
    },
    /** The compiled trace: read once `ready`. */
    pipeline: () => stages.pipelineOf(entry),
  }
}

/**
 * The trace that casts the rays through the scene's triangles (`CACHE_TRACED_PROGRAM`), made once for the device when a scene has
 * acceleration structures and the cache's rays are traced: compiled off the frame, not waited for by the cache's own kernels — until it
 * is `ready` the rays are marched through the field. Its layouts are the cache's own group with the cut's tables, and the scene trace's.
 */
export const tracedCacheKernels = oncePerDevice((device: GPUDevice) =>
  startedTracedKernel(
    device,
    'Trillion3D CACHE_TRACED',
    cacheTracedLayouts().map((entries, at) =>
      device.createBindGroupLayout({ label: `Trillion3D CACHE_TRACED group ${at}`, entries }),
    ),
    CACHE_TRACED_PROGRAM,
    TRACE_ENTRY,
  ),
)

/** The traced trace's kernels, made. */
export type TracedCacheKernels = ReturnType<typeof tracedCacheKernels>

/** The cache's kernels, made. */
export type CacheKernels = Awaited<ReturnType<typeof createCacheKernels>>
