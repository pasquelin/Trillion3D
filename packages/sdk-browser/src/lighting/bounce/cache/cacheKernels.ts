import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { buildComputeStage } from '../../../gpu/core/computeStages.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import {
  cacheFilterEntries,
  cacheMipsEntries,
  cacheTilesEntries,
  cacheTraceEntries,
} from './cacheBindings.ts'
import { CACHE_FILTER_PROGRAM } from './cacheFilterWgsl.ts'
import { CACHE_MIPS_PROGRAM } from './cacheMipsWgsl.ts'
import { CACHE_TILES_PROGRAM } from './cacheTilesWgsl.ts'
import { CACHE_TRACE_PROGRAM } from './cacheTraceWgsl.ts'

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

/** The pipelines of the cache's kernels and the layouts of their groups: made once for a device, whatever the maps' shape. */
export async function createCacheKernels(device: GPUDevice) {
  const [tiles, trace, filter, mips] = await Promise.all([
    stage(
      device,
      CACHE_TILES_PROGRAM,
      'CACHE_TILES',
      cacheTilesEntries(),
      [['clearPdf'], ['generateTiles']],
      true,
    ),
    stage(device, CACHE_TRACE_PROGRAM, 'CACHE_TRACE', cacheTraceEntries(), [['traceTiles']], true),
    stage(device, CACHE_FILTER_PROGRAM, 'CACHE_FILTER', cacheFilterEntries(), [['filterMaps']]),
    stage(device, CACHE_MIPS_PROGRAM, 'CACHE_MIPS', cacheMipsEntries(), [
      ['buildMip', { CACHE_MIP: 1 }],
      ['buildMip', { CACHE_MIP: 2 }],
    ]),
  ])
  return {
    tiles: {
      layout: tiles.layout,
      clearPdf: tiles.pipelines[0],
      generateTiles: tiles.pipelines[1],
    },
    trace: { layout: trace.layout, traceTiles: trace.pipelines[0] },
    filter: { layout: filter.layout, filterMaps: filter.pipelines[0] },
    /** The pipelines that make the levels of detail one and two of the final maps, in that order. */
    mips: { layout: mips.layout, levels: mips.pipelines },
  }
}

/** The cache's kernels, made. */
export type CacheKernels = Awaited<ReturnType<typeof createCacheKernels>>
