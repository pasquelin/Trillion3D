import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { tileViewInverse } from './tileFrame.ts'
import { TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import {
  computeBufferEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import { createGrid, encodeGrid, recordsOf, START_WORD, type Grid } from './lightGrid.ts'
/** Columns of the light grid over `pixels`, at least one: the grid covers the whole target, never
 *  one column short. */
const tilesOn = (pixels: number) => workgroupCount(pixels, LIGHT_SETTINGS.tileSize)
export type GpuLightTiles = Awaited<ReturnType<typeof createGpuLightTiles>>

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
  /** The grid's group over the buffer and the lights it was last given, made again when either
   *  moved: a buffer the other grid's growth replaced is bound again by the next pass. */
  const bind = (grid: Grid) => {
    if (grid.bound.moved() || !grid.group)
      grid.group = device.createBindGroup({
        layout,
        entries: sequentialEntries([
          { buffer: grid.uniform },
          { buffer: grid.bound.next[0] as GPUBuffer },
          { buffer: state.tiles! },
          { buffer: grid.pool.state },
        ]),
      })
  }
  /** The buffer for both grids' columns and pools; `true` when the grid's group is ready. */
  const ensure = (grid: Grid, [x, y]: [number, number], lights: GPUBuffer, count: number) => {
    const other = grid === view ? world : view,
      others = recordsOf(other) + other.poolWords
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
    bind(grid)
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
    encode: (encoder: GPUCommandEncoder, frame: number) => encodeGrid(view, bind, encoder, frame),
    /** Encodes the world grid's pass. */
    encodeWorld: (encoder: GPUCommandEncoder, frame: number) =>
      encodeGrid(world, bind, encoder, frame),
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
