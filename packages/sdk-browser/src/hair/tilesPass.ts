import { autoKernel } from '../gpu/core/computeStages.ts'
import { bufferEntries, sequentialEntries } from '../gpu/core/computeBindings.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { uniformSubgroupLanes } from '../gpu/core/subgroups.ts'
import { boundGroups } from './ribbonBinds.ts'
import { ARGS_WGSL, SUBGROUP_TILES_WGSL, WORKGROUP_TILES_WGSL } from './tilesWgsl.ts'
import {
  HAIR_DISPATCH_ARGS_WORDS,
  HAIR_DRAW_ARGS_WORDS,
  HAIR_TILE_LISTS,
} from './visibilityMath.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The subgroup sizes the tiles are classified on subgroups at, the first the device holds. */
const SUBGROUP_LANES = [64, 32] as const

const workgroupKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}tiles`,
  WORKGROUP_TILES_WGSL,
  'hairTiles',
)
const subgroupKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}tiles (subgroups)`,
  SUBGROUP_TILES_WGSL,
  'hairTiles',
)
const argsKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}tile arguments`,
  ARGS_WGSL,
  'hairTileArgs',
)

/** The bind groups of the tiles' passes, kept while the resources they name stay. */
function tileBinds() {
  return {
    classify: boundGroups<GPUBuffer, GPUTextureView, HairTiles>(
      1,
      (device, pipeline, image, transmittance, tiles) =>
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: sequentialEntries([
            { buffer: image },
            transmittance,
            { buffer: tiles.counts },
            { buffer: tiles.data },
          ]),
        }),
    ),
    args: boundGroups<HairTiles, undefined, undefined>(1, (device, pipeline, tiles) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: bufferEntries([tiles.counts, tiles.drawArgs, tiles.dispatchArgs]),
      }),
    ),
  }
}

/** The tiles of a view: the lists, how many each holds, and the arguments of the draws and dispatches
 *  over each. The list of a kind is `capacity` words from `kind * capacity` in `data`: a tile is its
 *  x in the low 16 bits and its y in the high 16. */
export interface HairTiles {
  readonly capacity: number
  readonly counts: GPUBuffer
  readonly data: GPUBuffer
  /** `HAIR_DRAW_ARGS_WORDS` words a list: a draw of its tiles. */
  readonly drawArgs: GPUBuffer
  /** `HAIR_DISPATCH_ARGS_WORDS` words a list: a dispatch of its tiles. */
  readonly dispatchArgs: GPUBuffer
  readonly binds: ReturnType<typeof tileBinds>
}

/** The buffers of tiles with room for `capacity` in a list, named to `allocator`: the counts (also a
 *  uniform, the shadow maps' marking reading them as one, `vsmHairPageMarkingWgsl`) and the lists, and the
 *  arguments of the draws and the dispatches; `readback` is the usage a proof that reads them back adds
 *  (`HairViewGpu.readback`). */
export const allocateHairTiles = (
  allocator: ResourceAllocator,
  capacity: number,
  readback: GPUBufferUsageFlags,
) => ({
  counts: allocator.buffer(
    'tile counts',
    HAIR_TILE_LISTS,
    'storage',
    GPUBufferUsage.UNIFORM | readback,
  ),
  data: allocator.buffer('tile lists', HAIR_TILE_LISTS * capacity, 'storage', readback),
  drawArgs: allocator.buffer(
    'tile draw arguments',
    HAIR_TILE_LISTS * HAIR_DRAW_ARGS_WORDS,
    'args',
    readback,
  ),
  dispatchArgs: allocator.buffer(
    'tile dispatch arguments',
    HAIR_TILE_LISTS * HAIR_DISPATCH_ARGS_WORDS,
    'args',
    readback,
  ),
})

/** The tiles over `buffers`, made as `allocateHairTiles(_, capacity)` describes. */
export const hairTiles = (
  capacity: number,
  buffers: Pick<HairTiles, 'counts' | 'data' | 'drawArgs' | 'dispatchArgs'>,
): HairTiles => ({ capacity, ...buffers, binds: tileBinds() })

/** The pipelines the tiles are built with on `device`, none while one compiles. */
export function tilePipelines(device: GPUDevice) {
  const lanes = uniformSubgroupLanes(device, SUBGROUP_LANES)
  const classify = (lanes ? subgroupKernel : workgroupKernel)(device).get()
  const args = argsKernel(device).get()
  return classify && args ? { classify, args } : undefined
}

/** Empties the lists of `tiles`, outside any pass of `encoder`. */
export const clearHairTiles = (encoder: GPUCommandEncoder, tiles: HairTiles) =>
  encoder.clearBuffer(tiles.counts)

/**
 * Builds the lists of `tiles` from the transmittance `view` of the image, in `pass`: the tiles of
 * the rectangle `rect` (`[x0, y0, x1, y1]` in tiles) classified, then the arguments of the draws and
 * dispatches written. `image` is the image block (`HAIR_IMAGE_WGSL`) holding the rectangle's first
 * tile.
 */
export function encodeHairTiles(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipelines: NonNullable<ReturnType<typeof tilePipelines>>,
  tiles: HairTiles,
  image: GPUBuffer,
  transmittance: GPUTextureView,
  rect: readonly [number, number, number, number],
) {
  pass.setPipeline(pipelines.classify)
  pass.setBindGroup(
    0,
    tiles.binds.classify(device, pipelines.classify, image, transmittance, tiles),
  )
  pass.dispatchWorkgroups(rect[2] - rect[0], rect[3] - rect[1])
  pass.setPipeline(pipelines.args)
  pass.setBindGroup(0, tiles.binds.args(device, pipelines.args, tiles, undefined, undefined))
  pass.dispatchWorkgroups(1)
}
