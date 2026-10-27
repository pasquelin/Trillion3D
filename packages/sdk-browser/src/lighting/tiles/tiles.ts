import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { tileViewInverse } from './tileFrame.ts'
import { GRID_HEAD_WORDS, TILE_STRIDE_WORDS } from '../direct/lightWgsl.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../math/src/scalar/reals.ts'
import {
  computeBufferEntry,
  computeUniformEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'
import {
  CELL_WORDS_WORD,
  createGrid,
  CULL_WORD,
  encodeGrid,
  recordsOf,
  START_WORD,
  type Grid,
} from './lightGrid.ts'
import { LIGHT_LINK_STRIDE } from './compactWgsl.ts'
import { grownByCopy } from '../../gpu/core/tableGrowth.ts'
import { createCullBinding } from './cullBinding.ts'
import type { LightGridCull } from './cullView.ts'
/** Columns of the light grid over `pixels`, at least one: the grid covers the whole target, never
 *  one column short. */
const tilesOn = (pixels: number) => workgroupCount(pixels, LIGHT_SETTINGS.tileSize)
export type GpuLightTiles = Awaited<ReturnType<typeof createGpuLightTiles>>

/**
 * The light grid's pass (`./shader.ts`) over the buffer every reader of a list binds: the slice map
 * its pass and its readers share (`./gridMap.ts`), its records then the pool of their lists
 * (`./pool.ts`); and the buffer of the links the lists are made from, which only the pass binds.
 * The grid is laid out again only when it needs more columns or its pool changes — the buffers
 * grown by the engine's one rule, the old ones retired; the group follows the light buffer,
 * which grows with the scene; encoding allocates nothing. The pass reads the depth pyramid
 * of the image (`./cullWgsl.ts`, `./cullView.ts`).
 */
export async function createGpuLightTiles(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0),
      computeBufferEntry(1, 'read-only-storage'),
      computeBufferEntry(2, 'storage'),
      computeBufferEntry(3, 'storage'),
      computeBufferEntry(4, 'storage'),
    ],
  })
  const cull = createCullBinding(device)
  const view = await createGrid(device, [layout, cull.layout]).catch((error) => {
    cull.dispose()
    throw error
  })
  return lightTiles(device, layout, view, cull)
}

/** What the light grid's calls hold between images. */
interface TilesState {
  readonly device: GPUDevice
  readonly layout: GPUBindGroupLayout
  readonly view: Grid
  readonly cull: ReturnType<typeof createCullBinding>
  tiles: GPUBuffer | undefined
  /** The links of the cells' chains, `LIGHT_LINK_STRIDE` words for each word of the pool. */
  links: GPUBuffer | undefined
  pyramid: GPUBindGroup
  readonly inverse: Float64Array
  readonly origin: Float64Array
  readonly rows: Float64Array
}

/** The grid's group over the buffer and the lights it was last given, made again when either moved. */
function bindGrid(s: TilesState, grid: Grid) {
  if (grid.bound.moved() || !grid.group)
    grid.group = s.device.createBindGroup({
      layout: s.layout,
      entries: sequentialEntries([
        { buffer: grid.uniform },
        { buffer: grid.bound.next[0] as GPUBuffer },
        { buffer: s.tiles! },
        { buffer: grid.pool.state },
        { buffer: s.links! },
      ]),
    })
}

/** The largest buffer the device binds, in whole words. */
const bindableBytes = (device: GPUDevice) => Math.floor(storageBufferCap(device.limits) / 4) * 4

/** The grid laid out again in the buffer and its links, each grown by the engine's one rule
 *  (`sizedBuffer`), never past what the device binds. */
function reallocate(s: TilesState) {
  const { device, view } = s
  view.start = GRID_HEAD_WORDS
  // Copyable, as the pool state: a proof reads the lists back.
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  const bounded = ({ label, size, usage }: GPUBufferDescriptor) =>
    device.createBuffer({ label, size: Math.min(size, bindableBytes(device)), usage })
  s.tiles = sizedBuffer(
    device,
    s.tiles,
    (view.start + recordsOf(view) + view.poolWords) * 4,
    usage,
    'Trillion3D light tiles v1',
    bounded,
  )
  // The cells' lists made without links bind one link; the chains of links, one for each word of
  // the pool (at least one: a pool without room still binds a buffer).
  const linkBytes = (view.cellWords ? 1 : Math.max(1, view.poolWords)) * LIGHT_LINK_STRIDE * 4
  if (view.cellWords && s.links && s.links.size > linkBytes) {
    grownByCopy(device, [s.links])
    s.links = undefined
  }
  s.links = sizedBuffer(
    device,
    s.links,
    linkBytes,
    usage,
    'Trillion3D light tile links v1',
    bounded,
  )
  view.group = undefined
}

/** The buffer for the grid's columns and pool; `true` when the grid's group is ready. */
function ensureGrid(
  s: TilesState,
  [x, y]: [number, number],
  lights: GPUBuffer,
  perCell: number,
  linked: boolean,
) {
  const { view: grid } = s
  // Fewer columns than laid out keep the layout: views of other shapes drawn in turn share it.
  const fits = !!s.tiles && x * y <= grid.columns
  const columns = fits ? grid.columns : x * y
  const records = columns * grid.slices * TILE_STRIDE_WORDS
  // The pool never takes the buffer past what the device binds, nor, for chains of links, the
  // links the buffer of the links: past it, the columns without room drop their lights.
  const cap = storageBufferCap(s.device.limits)
  const room = Math.floor(cap / 4) - records - GRID_HEAD_WORDS
  const wantedPool = clampLowWins(
    columns * grid.slices * perCell,
    0,
    linked ? Math.min(room, Math.floor(cap / (4 * LIGHT_LINK_STRIDE))) : room,
  )
  grid.poolLimited = wantedPool < columns * grid.slices * perCell
  grid.tilesX = x
  grid.tilesY = y
  const cellWords = linked ? 0 : perCell
  // The same columns with another pool: the setting `lightGridMaxCulledLightsPerCell` moved; or
  // with another kind of lists: the setting `lightGridLinkedLists`, which sizes the links.
  if (!fits || wantedPool !== grid.poolWords || cellWords !== grid.cellWords) {
    grid.columns = columns
    grid.poolWords = wantedPool
    grid.cellWords = cellWords
    reallocate(s)
  }
  grid.bound.next[0] = lights
  bindGrid(s, grid)
  return !!grid.group
}

/** A grid's uniform as `packed` holds it, its records' start and the words each cell has in the
 *  pool, and its pool opened past them. */
function uploadGrid(s: TilesState, grid: Grid) {
  grid.words[START_WORD] = grid.start
  grid.words[CELL_WORDS_WORD] = grid.cellWords
  s.device.queue.writeBuffer(grid.uniform, 0, grid.packed)
  grid.pool.open(grid.start + recordsOf(grid), grid.poolWords, grid.poolLimited)
}

/** The view grid's matrices, size and cull of this image. */
function updateViewGrid(
  s: TilesState,
  viewProjection: ArrayLike<number>,
  eye: ArrayLike<number>,
  width: number,
  height: number,
  depthCull: LightGridCull,
) {
  const { view, inverse, origin, rows } = s
  const { packed } = view
  packed.set(tileViewInverse(inverse, origin, viewProjection, eye, rows), 0)
  packed[16] = width
  packed[17] = height
  packed[18] = view.tilesX
  packed[19] = view.tilesY
  packed.set(origin, 20)
  packed.set(rows, 24)
  packed.set(depthCull.words, CULL_WORD)
  s.pyramid = s.cull.group(depthCull.depth)
  if (s.tiles) s.device.queue.writeBuffer(s.tiles, 0, depthCull.map)
  uploadGrid(s, view)
}

/** The calls of the light grid over its state. */
function tileCalls(s: TilesState) {
  const { view, cull } = s
  const bind = (grid: Grid) => bindGrid(s, grid)
  return {
    /** The view pool's frame metrics: the last sample. */
    poolMetrics() {
      const sample = view.pool.sample()
      return {
        tileLightPoolReserved: sample?.reserved ?? null,
        tileLightPoolCapacity: sample?.capacity ?? null,
        tileLightPoolOverflowed: sample?.overflowed ?? null,
      }
    },
    /** Ensures the buffer, the grid's pool of `perCell` words a cell (the setting
     *  `lightGridMaxCulledLightsPerCell`), the lists made by chains of links or, `linked` false,
     *  in the words of each cell (the setting `lightGridLinkedLists`), and its group; `true` if its
     *  pass is ready. */
    ensure: (width: number, height: number, lights: GPUBuffer, perCell: number, linked: boolean) =>
      ensureGrid(s, [tilesOn(width), tilesOn(height)], lights, perCell, linked),
    /** The render matrix (jitter included) and the eye, both absolute and in f64, and the image's
     *  cull (`cullView.ts`): the pyramid its pass reads and the numbers it cuts by. */
    update: (
      viewProjection: ArrayLike<number>,
      eye: ArrayLike<number>,
      width: number,
      height: number,
      depthCull: LightGridCull,
    ) => updateViewGrid(s, viewProjection, eye, width, height, depthCull),
    /** Encodes the view grid's pass of image `frame`, one workgroup a column; its pool state is
     *  sampled after. */
    encode: (encoder: GPUCommandEncoder, frame: number) =>
      encodeGrid(view, bind, encoder, frame, s.pyramid),
    /** Requests mapping of the pools' samples, once the frame that copied them is submitted. */
    submitted() {
      view.pool.submitted()
    },
    dispose() {
      view.pool.dispose()
      view.uniform.destroy()
      view.group = undefined
      cull.dispose()
      s.tiles?.destroy()
      s.tiles = undefined
      s.links?.destroy()
      s.links = undefined
    },
  }
}

/** The pass's calls (`createGpuLightTiles`) on its grid. */
function lightTiles(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  view: Grid,
  cull: ReturnType<typeof createCullBinding>,
) {
  const s: TilesState = {
    device,
    layout,
    view,
    cull,
    tiles: undefined,
    links: undefined,
    pyramid: cull.group(),
    inverse: new Float64Array(16),
    origin: new Float64Array(3),
    rows: new Float64Array(8),
  }
  return {
    /** The buffer every reader of a list binds; never undefined after an `ensure()`. */
    get buffer() {
      return s.tiles
    },
    get tilesX() {
      return view.tilesX
    },
    get tilesY() {
      return view.tilesY
    },
    /** The words the grid takes from the buffer's head: its records and its pool, the extent the shadowed lights' grid
     *  is made over (`vsmLightGridFor`). */
    get worldStart() {
      return view.start + recordsOf(view) + view.poolWords
    },
    ...tileCalls(s),
  }
}
