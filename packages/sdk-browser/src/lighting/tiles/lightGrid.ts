/**
 * ONE GRID of the light grid's buffer (`tiles.ts`): its pass, its uniform, its pool and its
 * columns, made once, and its pass encoded.
 */
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { lightTilesShader } from './shader.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts'
import { createTileLightPool } from './pool.ts'
import { buildComputeStage } from '../../gpu/core/computeStages.ts'
import { LIGHT_TILES_PASS } from '../../diagnostic/stage/passLabels.ts'

/** The pass's uniform: the inverse matrix, the viewport and columns, the origin, two depth rows,
 *  the word the grid's records start at, the cull (`TileView.cull`) and the fog's slice map
 *  (`TileView.sliceMap`). */
const UNIFORM_FLOATS = 44
/** The uniform's word of the records' start (`TileView.start`). */
export const START_WORD = 32
/** The uniform's word of the cull (`cullView.ts`): its seven numbers, `cull` then `sliceMap`. */
export const CULL_WORD = 36

/** The grid of the buffer: its pass, its uniform and its pool, its columns and the words it takes. */
export type Grid = {
  pipeline: GPUComputePipeline
  uniform: GPUBuffer
  pool: ReturnType<typeof createTileLightPool>
  packed: Float32Array<ArrayBuffer>
  words: Uint32Array<ArrayBuffer>
  /** Its pass, named for the profile. */
  pass: GPUComputePassDescriptor
  /** Cells a column holds: the view's depth slices. */
  slices: number
  /** The light buffer its group names. */
  bound: ReturnType<typeof createWebgpuBindIdentity>
  group?: GPUBindGroup
  tilesX: number
  tilesY: number
  /** Columns its records are laid out for, at least `tilesX × tilesY`: views of other shapes
   *  drawn in turn (`world.addView`) reuse the layout instead of laying the buffer out again. */
  columns: number
  poolWords: number
  /** Its records' first word in the buffer. */
  start: number
}

/** The grid's records' words. */
export const recordsOf = (g: Grid) => g.columns * g.slices * TILE_STRIDE_WORDS

export async function createGrid(device: GPUDevice, layouts: GPUBindGroupLayout[]) {
  const module = await createCheckedShaderModule(device, lightTilesShader(), 'LIGHT_TILES_SHADER')
  const pipeline = await buildComputeStage(device, layouts, module, 'lightTiles')
  const packed = new Float32Array(UNIFORM_FLOATS)
  const grid: Grid = {
    pipeline,
    uniform: device.createBuffer({
      label: 'Trillion3D light tile view v1',
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    pool: createTileLightPool(device),
    packed,
    words: new Uint32Array(packed.buffer),
    pass: { label: LIGHT_TILES_PASS },
    slices: LIGHT_SETTINGS.gridSlices,
    bound: createWebgpuBindIdentity(),
    tilesX: 0,
    tilesY: 0,
    columns: 0,
    poolWords: 0,
    start: 0,
  }
  return grid
}

/** The grid's pass (`tiles.ts`), its group bound again first when its buffer moved
 *  (`bind`), and the depth pyramid's group `cull` the view's grid reads (`cullView.ts`); none for a
 *  grid never sized. */
export function encodeGrid(
  grid: Grid,
  bind: (grid: Grid) => void,
  encoder: GPUCommandEncoder,
  frame: number,
  cull?: GPUBindGroup,
) {
  if (!grid.group && !grid.bound.next[0]) return false
  bind(grid)
  if (!grid.group) return false
  const pass = encoder.beginComputePass(grid.pass)
  pass.setPipeline(grid.pipeline)
  pass.setBindGroup(0, grid.group)
  if (cull) pass.setBindGroup(1, cull)
  pass.dispatchWorkgroups(grid.tilesX, grid.tilesY, 1)
  pass.end()
  grid.pool.sampleState(encoder, frame)
  return true
}
