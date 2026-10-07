import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { tileViewInverse } from './tileFrame.ts'
import { LIGHT_TILES_SHADER } from './shader.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts'
import { createTileLightPool } from './pool.ts'
import { buildComputePipeline } from '../deferred/fullscreen.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { LIGHT_TILES_PASS } from '../../stage/passLabels.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
/** Columns of the light grid over `pixels`, at least one: the grid covers the whole target, never
 *  one column short. */
const tilesOn = (pixels: number) => workgroupCount(pixels, LIGHT_SETTINGS.tileSize)
/** The pass's uniform: the inverse matrix, the viewport and columns, the origin, two depth rows. */
const UNIFORM_FLOATS = 32
export type GpuLightTiles = Awaited<ReturnType<typeof createGpuLightTiles>>

/** What the pass is made of, fixed for its life, and the words its uniform is written from. */
type TileParts = {
  device: GPUDevice
  layout: GPUBindGroupLayout
  uniform: GPUBuffer
  pool: ReturnType<typeof createTileLightPool>
  pipeline: GPUComputePipeline
  packed: Float32Array<ArrayBuffer>
  inverse: Float64Array
  origin: Float64Array
  rows: Float64Array
  /** The light buffer the group names. */
  bound: ReturnType<typeof createWebgpuBindIdentity>
}
/** The grid buffer, its group, its columns and rows, its pool's words and how often it grew. */
type TileState = {
  tiles?: GPUBuffer
  group?: GPUBindGroup
  tilesX: number
  tilesY: number
  poolWords: number
  growths: number
}

/**
 * The light grid's pass (`./shader.ts`). The grid buffer — the cell records, then the pool
 * of their lists (`./pool.ts`) — is allocated for the current target and reallocated only when it
 * changes size or the pool grows; the group follows the light buffer, which grows with the scene;
 * encoding allocates nothing. The pass reads no depth: its cells are the view's own.
 */
export async function createGpuLightTiles(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, LIGHT_TILES_SHADER, 'LIGHT_TILES_SHADER')
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D light tile view v1',
    size: UNIFORM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const packed = new Float32Array(UNIFORM_FLOATS),
    inverse = new Float64Array(16),
    origin = new Float64Array(3),
    rows = new Float64Array(8)
  const pool = createTileLightPool(device)
  let pipeline: GPUComputePipeline
  try {
    pipeline = await buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'lightTiles' },
    })
  } catch (error) {
    uniform.destroy()
    pool.dispose()
    throw error
  }
  const bound = createWebgpuBindIdentity()
  return lightTiles({
    device,
    layout,
    uniform,
    pool,
    pipeline,
    packed,
    inverse,
    origin,
    rows,
    bound,
  })
}

/** The pass's calls (`createGpuLightTiles`) on what it is made of. */
function lightTiles(parts: TileParts) {
  const { device, uniform, pool, packed, inverse, origin, rows } = parts
  const state: TileState = { tilesX: 0, tilesY: 0, poolWords: 0, growths: 0 }
  return {
    /** Buffer the deferred resolve rereads; never undefined after an `ensure()`. */
    get buffer() {
      return state.tiles
    },
    get tilesX() {
      return state.tilesX
    },
    get tilesY() {
      return state.tilesY
    },
    /** The pool's frame metrics: the last sample, and its growths. */
    poolMetrics() {
      const sample = pool.sample()
      return {
        tileLightPoolReserved: sample?.reserved ?? null,
        tileLightPoolCapacity: sample?.capacity ?? null,
        tileLightPoolOverflowed: sample?.overflowed ?? null,
        tileLightPoolGrowths: state.growths,
      }
    },
    /** Ensures the grid buffer, its pool sized for `count` lights, and the bind group; `true` if
     *  the pass is ready. */
    ensure: (width: number, height: number, lights: GPUBuffer, count: number) =>
      ensureTiles(parts, state, width, height, lights, count),
    /** The render matrix (jitter included) and the eye, both absolute and in f64. */
    update(
      viewProjection: ArrayLike<number>,
      eye: ArrayLike<number>,
      width: number,
      height: number,
    ) {
      const { tilesX, tilesY } = state
      packed.set(tileViewInverse(inverse, origin, viewProjection, eye, rows), 0)
      packed[16] = width
      packed[17] = height
      packed[18] = tilesX
      packed[19] = tilesY
      packed.set(origin, 20)
      packed.set(rows, 24)
      device.queue.writeBuffer(uniform, 0, packed)
      pool.open(tilesX * tilesY * LIGHT_SETTINGS.gridSlices * TILE_STRIDE_WORDS, state.poolWords)
    },
    /** Encodes the pass of image `frame`, one workgroup a column; its pool state is sampled after. */
    encode: (encoder: GPUCommandEncoder, frame: number) =>
      encodeTiles(parts, state, encoder, frame),
    /** Requests mapping of the pool sample, once the frame that copied it is submitted. */
    submitted: pool.submitted,
    dispose() {
      pool.dispose()
      uniform.destroy()
      state.tiles?.destroy()
      state.tiles = undefined
      state.group = undefined
    },
  }
}

/** The pass's `ensure`: the grid buffer, reallocated when the view's columns change or the pool
 *  wants more words, and the group, rebuilt when the buffer or the light buffer it names does. */
function ensureTiles(
  { device, layout, uniform, pool, bound }: TileParts,
  state: TileState,
  width: number,
  height: number,
  lights: GPUBuffer,
  count: number,
) {
  const wantedX = tilesOn(width),
    wantedY = tilesOn(height),
    records = wantedX * wantedY * LIGHT_SETTINGS.gridSlices * TILE_STRIDE_WORDS
  // The pool never takes the buffer past what the device binds: a cell with no room walks all.
  const room = Math.floor(storageBufferCap(device.limits) / 4) - records
  const wantedPool = Math.max(0, Math.min(pool.words(wantedX * wantedY, count), room))
  const { tilesX, tilesY, poolWords } = state
  if (!state.tiles || wantedX !== tilesX || wantedY !== tilesY || wantedPool > poolWords) {
    state.tiles?.destroy()
    // The same view with more pool words: the pool grew, to what an overflowing frame asked or
    // to more lights.
    if (poolWords && wantedX === tilesX && wantedY === tilesY) state.growths++
    state.tilesX = wantedX
    state.tilesY = wantedY
    state.poolWords = wantedPool
    state.tiles = device.createBuffer({
      label: 'Trillion3D light tiles v1',
      size: (records + wantedPool) * 4,
      // Copyable, as the pool state: a proof reads the lists back.
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    state.group = undefined
  }
  bound.next[0] = lights
  if (bound.moved() || !state.group) {
    state.group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: lights } },
        { binding: 2, resource: { buffer: state.tiles } },
        { binding: 3, resource: { buffer: pool.state } },
      ],
    })
  }
  return !!state.group
}

/** The pass's `encode` (`createGpuLightTiles`). */
function encodeTiles(
  { pipeline, pool }: TileParts,
  state: TileState,
  encoder: GPUCommandEncoder,
  frame: number,
) {
  const { group } = state
  if (!group) return false
  const pass = encoder.beginComputePass({ label: LIGHT_TILES_PASS })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(state.tilesX, state.tilesY, 1)
  pass.end()
  pool.sampleState(encoder, frame)
  return true
}
