import { BOUNCE_SETTINGS, LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts'
import { tileViewInverse } from './tileFrame.ts'
import { lightTilesShader, type LightGridKind } from './shader.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { createWebgpuBindIdentity } from '../../webgpu/core/bindIdentity.ts'
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts'
import { createTileLightPool } from './pool.ts'
import { buildComputePipeline } from '../deferred/fullscreen.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { BOUNCE_LIGHT_LISTS_PASS, LIGHT_TILES_PASS } from '../../stage/passLabels.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import {
  computeBufferEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
/** Columns of the light grid over `pixels`, at least one: the grid covers the whole target, never
 *  one column short. */
const tilesOn = (pixels: number) => workgroupCount(pixels, LIGHT_SETTINGS.tileSize)
/** The pass's uniform: the inverse matrix, the viewport and columns, the origin, two depth rows,
 *  the word the grid's records start at. */
const UNIFORM_FLOATS = 36
/** The uniform's word of the records' start (`TileView.start`). */
const START_WORD = 32
export type GpuLightTiles = Awaited<ReturnType<typeof createGpuLightTiles>>

/** One grid of the buffer: its pass, its uniform and its pool, its columns and the words it takes. */
type Grid = {
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
const recordsOf = (g: Grid) => g.tilesX * g.tilesY * g.slices * TILE_STRIDE_WORDS

async function createGrid(device: GPUDevice, kind: LightGridKind, layout: GPUBindGroupLayout) {
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

/**
 * The light grid's passes (`./shader.ts`) over ONE buffer every reader of a list binds: the view's
 * grid — its cells the view's, its records then the pool of their lists (`./pool.ts`) — then the
 * bounce's world grid over the last cascade level's lattice (`ensureWorld`), its records then its
 * pool. The buffer is reallocated only when a grid changes columns or its pool grows — then the
 * world grid's lists are listed again (`revision`) —; each grid's group follows the light buffer,
 * which grows with the scene; encoding allocates nothing. The passes read no depth.
 */
export async function createGpuLightTiles(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0),
      computeBufferEntry(1, 'read-only-storage'),
      computeBufferEntry(2, 'storage'),
      computeBufferEntry(3, 'storage'),
    ],
  })
  const view = await createGrid(device, 'view', layout)
  const world = await createGrid(device, 'world', layout).catch((error) => {
    view.uniform.destroy()
    view.pool.dispose()
    throw error
  })
  return lightTiles(device, layout, view, world)
}

/** The passes' calls (`createGpuLightTiles`) on their two grids. */
function lightTiles(device: GPUDevice, layout: GPUBindGroupLayout, view: Grid, world: Grid) {
  const inverse = new Float64Array(16),
    origin = new Float64Array(3),
    rows = new Float64Array(8)
  const state = { tiles: undefined as GPUBuffer | undefined, revision: 0 }
  const grids = [view, world]
  /** The buffer for both grids' columns and pools; `true` when each grid's group is ready. */
  const ensure = (grid: Grid, [x, y]: [number, number], lights: GPUBuffer, count: number) => {
    const others = grids
      .filter((g) => g !== grid)
      .reduce((n, g) => n + recordsOf(g) + g.poolWords, 0)
    const records = x * y * grid.slices * TILE_STRIDE_WORDS
    // The pool never takes the buffer past what the device binds: a cell with no room walks all.
    const room = Math.floor(storageBufferCap(device.limits) / 4) - records - others
    const wantedPool = clampLowWins(grid.pool.words(x * y, count, grid.slices), 0, room)
    if (!state.tiles || x !== grid.tilesX || y !== grid.tilesY || wantedPool > grid.poolWords) {
      // The same columns with more pool words: the pool grew, to what an overflowing frame asked
      // or to more lights.
      if (grid.poolWords && x === grid.tilesX && y === grid.tilesY) grid.growths++
      grid.tilesX = x
      grid.tilesY = y
      grid.poolWords = wantedPool
      reallocate()
    }
    grid.bound.next[0] = lights
    if (grid.bound.moved() || !grid.group)
      grid.group = device.createBindGroup({
        layout,
        entries: sequentialEntries([
          { buffer: grid.uniform },
          { buffer: lights },
          { buffer: state.tiles! },
          { buffer: grid.pool.state },
        ]),
      })
    return !!grid.group
  }
  /** Both grids in a new buffer: the view's, then the world's. */
  const reallocate = () => {
    state.tiles?.destroy()
    view.start = 0
    world.start = recordsOf(view) + view.poolWords
    state.tiles = device.createBuffer({
      label: 'Trillion3D light tiles v1',
      size: (world.start + recordsOf(world) + world.poolWords) * 4,
      // Copyable, as the pool state: a proof reads the lists back.
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    })
    for (const grid of grids) grid.group = undefined
    state.revision++
  }
  /** A grid's uniform as `packed` holds it, its records' start, and its pool opened past them. */
  const upload = (grid: Grid) => {
    grid.words[START_WORD] = grid.start
    device.queue.writeBuffer(grid.uniform, 0, grid.packed)
    grid.pool.open(grid.start + recordsOf(grid), grid.poolWords)
  }
  return {
    /** The buffer every reader of a list binds; never undefined after an `ensure()`. */
    get buffer() {
      return state.tiles
    },
    get tilesX() {
      return view.tilesX
    },
    get tilesY() {
      return view.tilesY
    },
    /** The world grid's records' first word (`bounceLightSlice`). */
    get worldStart() {
      return world.start
    },
    /** Rises with every new buffer: the world grid's lists are then listed again. */
    get revision() {
      return state.revision
    },
    /** The view pool's frame metrics: the last sample, and its growths. */
    poolMetrics() {
      const sample = view.pool.sample()
      return {
        tileLightPoolReserved: sample?.reserved ?? null,
        tileLightPoolCapacity: sample?.capacity ?? null,
        tileLightPoolOverflowed: sample?.overflowed ?? null,
        tileLightPoolGrowths: view.growths,
      }
    },
    /** Ensures the buffer, the view grid's pool sized for `count` lights, and its group; `true` if
     *  its pass is ready. */
    ensure: (width: number, height: number, lights: GPUBuffer, count: number) =>
      ensure(view, [tilesOn(width), tilesOn(height)], lights, count),
    /** The world grid's `ensure`: `side` × `side` columns of `side` cells. */
    ensureWorld: (side: number, lights: GPUBuffer, count: number) =>
      ensure(world, [side, side], lights, count),
    /** The world grid's lattice: its lowest corner and a cell's side. */
    updateWorld(corner: ArrayLike<number>, cell: number) {
      world.packed.fill(0)
      world.packed[18] = world.tilesX
      world.packed[19] = world.tilesY
      world.packed.set(corner, 20)
      world.packed[23] = cell
      upload(world)
    },
    /** The render matrix (jitter included) and the eye, both absolute and in f64. */
    update(
      viewProjection: ArrayLike<number>,
      eye: ArrayLike<number>,
      width: number,
      height: number,
    ) {
      const { packed } = view
      packed.set(tileViewInverse(inverse, origin, viewProjection, eye, rows), 0)
      packed[16] = width
      packed[17] = height
      packed[18] = view.tilesX
      packed[19] = view.tilesY
      packed.set(origin, 20)
      packed.set(rows, 24)
      upload(view)
    },
    /** Encodes the view grid's pass of image `frame`, one workgroup a column; its pool state is
     *  sampled after. */
    encode: (encoder: GPUCommandEncoder, frame: number) => encodeGrid(view, encoder, frame),
    /** Encodes the world grid's pass. */
    encodeWorld: (encoder: GPUCommandEncoder, frame: number) => encodeGrid(world, encoder, frame),
    /** Requests mapping of the pools' samples, once the frame that copied them is submitted. */
    submitted() {
      view.pool.submitted()
      world.pool.submitted()
    },
    dispose() {
      for (const grid of grids) {
        grid.pool.dispose()
        grid.uniform.destroy()
        grid.group = undefined
      }
      state.tiles?.destroy()
      state.tiles = undefined
    },
  }
}

/** A grid's pass (`createGpuLightTiles`). */
function encodeGrid(grid: Grid, encoder: GPUCommandEncoder, frame: number) {
  if (!grid.group) return false
  const pass = encoder.beginComputePass({ label: grid.label })
  pass.setPipeline(grid.pipeline)
  pass.setBindGroup(0, grid.group)
  pass.dispatchWorkgroups(grid.tilesX, grid.tilesY, 1)
  pass.end()
  grid.pool.sampleState(encoder, frame)
  return true
}
