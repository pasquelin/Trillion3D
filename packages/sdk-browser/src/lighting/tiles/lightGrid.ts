/**
 * ONE GRID of the light grid's buffer (`tiles.ts`): its pass, its uniform, its pool and its
 * columns, made once, and its pass encoded.
 */
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { lightTilesShader, type LightGridKind } from './shader.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts'
import { createTileLightPool } from './pool.ts'
import { buildComputePipeline } from '../deferred/fullscreen.ts'
import { BOUNCE_LIGHT_LISTS_PASS, LIGHT_TILES_PASS } from '../../stage/passLabels.ts'

/** The pass's uniform: the inverse matrix, the viewport and columns, the origin, two depth rows,
 *  the word the grid's records start at. */
const UNIFORM_FLOATS = 36
/** The uniform's word of the records' start (`TileView.start`). */
export const START_WORD = 32

/** One grid of the buffer: its pass, its uniform and its pool, its columns and the words it takes. */
export type Grid = {
  kind: LightGridKind
  pipeline: GPUComputePipeline
  uniform: GPUBuffer
  pool: ReturnType<typeof createTileLightPool>
  packed: Float32Array<ArrayBuffer>
  words: Uint32Array<ArrayBuffer>
  label: string
  /** Cells a column holds: the view's depth slices, the bounce lattice's cells along z. */
  slices: number
  /** The light buffer its group names. */
  bound: ReturnType<typeof createWebgpuBindIdentity>
  group?: GPUBindGroup
  tilesX: number
  tilesY: number
  poolWords: number
  growths: number
  /** Its records' first word in the buffer. */
  start: number
}

/** The grid's records' words. */
export const recordsOf = (g: Grid) => g.tilesX * g.tilesY * g.slices * TILE_STRIDE_WORDS

export async function createGrid(
  device: GPUDevice,
  kind: LightGridKind,
  layout: GPUBindGroupLayout,
) {
  const module = await createCheckedShaderModule(
    device,
    lightTilesShader(kind),
    kind === 'view' ? 'LIGHT_TILES_SHADER' : 'LIGHT_TILES_WORLD_SHADER',
  )
  const pipeline = await buildComputePipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'lightTiles' },
  })
  const packed = new Float32Array(UNIFORM_FLOATS)
  const grid: Grid = {
    kind,
    pipeline,
    uniform: device.createBuffer({
      label: `Trillion3D light tile ${kind} v1`,
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    pool: createTileLightPool(device),
    packed,
    words: new Uint32Array(packed.buffer),
    label: kind === 'view' ? LIGHT_TILES_PASS : BOUNCE_LIGHT_LISTS_PASS,
    slices: kind === 'view' ? LIGHT_SETTINGS.gridSlices : BOUNCE_SETTINGS.cascadeSize,
    bound: createWebgpuBindIdentity(),
    tilesX: 0,
    tilesY: 0,
    poolWords: 0,
    growths: 0,
    start: 0,
  }
  return grid
}

/** A grid's pass (`tiles.ts`), its group bound again first when its buffer moved
 *  (`bind`); none for a grid never sized. */
export function encodeGrid(
  grid: Grid,
  bind: (grid: Grid) => void,
  encoder: GPUCommandEncoder,
  frame: number,
) {
  if (!grid.group && !grid.bound.next[0]) return false
  bind(grid)
  if (!grid.group) return false
  const pass = encoder.beginComputePass({ label: grid.label })
  pass.setPipeline(grid.pipeline)
  pass.setBindGroup(0, grid.group)
  pass.dispatchWorkgroups(grid.tilesX, grid.tilesY, 1)
  pass.end()
  grid.pool.sampleState(encoder, frame)
  return true
}
