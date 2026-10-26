import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import {
  VOLUMETRIC_LIGHTMAP_CELL_TEXELS,
  VOLUMETRIC_LIGHTMAP_MAX_LAYOUT,
} from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import {
  brickPlace,
  brickRank,
  paddedBrickSide,
  type VolumetricLightmapCell,
  type VolumetricLightmapCellData,
  type VolumetricLightmapData,
} from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'

/**
 * THE FINEST BRICKS OF THE VOLUMETRIC LIGHTMAP, STREAMED BY CELL. The layers of the file hold the
 * coarser bricks, always resident; the finest bricks lie in cells (a grid of `texels` indirection
 * texels a side), read when a cell comes within the loading range of the view and let go when it
 * leaves it. A cell takes free slots of the atlas — bricks of its room past the file's own —,
 * writes its bricks' texels there, then points its indirection texels at them; leaving, it gives its
 * slots back and its indirection texels take the coarser brick's place again, which the file's
 * indirection volume keeps. The cells nearest the view are loaded first and win the room: a cell
 * the room cannot hold, once the ones farther are let go, is not loaded and is told once.
 */

/** Cells read at once. */
const IN_FLIGHT = 4
/** Bytes of a padded brick in a layer of four bytes a texel. */
const BRICK_BYTES = VOLUMETRIC_LIGHTMAP_CELL_TEXELS * 4

/** The bricks the file's layers hold: one past the greatest rank its indirection volume names. */
export function bricksOf(data: VolumetricLightmapData) {
  const bytes = data.indirection.bytes
  let top = 0
  for (let at = 0; at < bytes.length; at += 4) {
    if (bytes[at + 3] === 0) continue
    top = Math.max(top, brickRank(bytes[at], bytes[at + 1], bytes[at + 2]))
  }
  return top + 1
}

/** The bytes a padded brick takes in the textures: the ambient, the six coefficient layers and,
 *  where the file has one, the bent normal, four bytes a texel each. */
export const brickBytes = (data: VolumetricLightmapData) =>
  BRICK_BYTES * (data.skyBentNormal ? 8 : 7)

export interface CellStreamerOptions {
  /** The bricks the room holds past the file's own. */
  readonly room: number
  /** The bricks the file's layers hold. */
  readonly base: number
  readonly textures: readonly GPUTexture[]
  readonly read: (
    cell: VolumetricLightmapCell,
    signal: AbortSignal,
  ) => Promise<VolumetricLightmapCellData>
  /** Told once of what the room could not hold, and of a cell that failed to read. */
  readonly report: (code: string, detail?: unknown) => void
}

/** The value of `of` for each of the three axes. */
const axes = <T>(of: (axis: number) => T) => [of(0), of(1), of(2)]

/** What `update` compares with the last call: the cells in reach and the loads in flight, which it
 *  does nothing for again. */
interface ReachWatch {
  readonly from: number[]
  readonly to: number[]
  readonly lastFrom: number[]
  readonly lastTo: number[]
  pending: number
  free: number
}

/** The indirection volume of a lightmap and the writes of the texels of one cell of it. */
function indirectionGrid(
  device: GPUDevice,
  data: VolumetricLightmapData,
  texture: GPUTexture,
  live: Uint8Array,
  texels: number,
) {
  const [width, height, depth] = data.indirectionSize
  /** The indirection texels of the cell at `coordinates`: where they start and how many along each axis. */
  const box = (coordinates: readonly number[]) => {
    const low = coordinates.map((c) => c * texels)
    return { low, size: axes((a) => Math.min(texels, [width, height, depth][a] - low[a])) }
  }
  /** Copies the rows of `size` texels of the box at `low` from the volume `source` to `target`: into
   *  the same texels of a volume of the indirection's size, or packed from the first (`packed`). */
  const copyRows = (
    low: readonly number[],
    size: readonly number[],
    source: Uint8Array,
    target: Uint8Array,
    packed: boolean,
  ) => {
    for (let z = 0; z < size[2]; z++)
      for (let y = 0; y < size[1]; y++) {
        const at = ((low[2] + z) * height + low[1] + y) * width + low[0]
        const into = packed ? (z * size[1] + y) * size[0] : at
        target.set(source.subarray(at * 4, (at + size[0]) * 4), into * 4)
      }
  }
  /** Writes the indirection texels of the cell at `coordinates` as `live` holds them. */
  const publish = (coordinates: readonly number[]) => {
    const { low, size } = box(coordinates)
    const bytes = new Uint8Array(size[0] * size[1] * size[2] * 4)
    copyRows(low, size, live, bytes, true)
    device.queue.writeTexture(
      { texture, origin: low },
      bytes,
      { bytesPerRow: size[0] * 4, rowsPerImage: size[1] },
      { width: size[0], height: size[1], depthOrArrayLayers: size[2] },
    )
  }
  return { box, copyRows, publish }
}

/** Writes, for each layer, the bricks `order` names (indices into the cell's bricks, their slots
 *  consecutive in one row of the atlas's layout) as one block of texels: the first brick's place is
 *  the block's origin. */
function brickWriter(
  device: GPUDevice,
  textures: readonly GPUTexture[],
  base: number,
  padded: number,
) {
  /** The bricks of one layer, staged side by side along x for a run of them. */
  let staged = new Uint8Array(0)
  return (
    content: VolumetricLightmapCellData,
    order: readonly number[],
    first: number,
    count: number,
    slots: readonly number[],
  ) => {
    const [px, py, pz] = brickPlace(base + slots[order[first]])
    const origin = [px * padded, py * padded, pz * padded]
    const layers = [content.ambient, ...content.coefficients, content.skyBentNormal]
    layers.forEach((layer, k) => {
      if (!layer) return
      let data: Uint8Array = layer.subarray(
        order[first] * BRICK_BYTES,
        (order[first] + 1) * BRICK_BYTES,
      )
      if (count > 1) {
        // The bricks are laid out one after the other; the block is one row of bricks, each row of
        // texels of its z, y following the last brick's.
        if (staged.length < count * BRICK_BYTES) staged = new Uint8Array(count * BRICK_BYTES)
        const row = padded * 4
        for (let b = 0; b < count; b++) {
          const brick = layer.subarray(
            order[first + b] * BRICK_BYTES,
            (order[first + b] + 1) * BRICK_BYTES,
          )
          for (let r = 0; r < padded * padded; r++)
            staged.set(brick.subarray(r * row, (r + 1) * row), (r * count + b) * row)
        }
        data = staged.subarray(0, count * BRICK_BYTES)
      }
      device.queue.writeTexture(
        { texture: textures[1 + k], origin },
        data as Uint8Array<ArrayBuffer>,
        { bytesPerRow: count * padded * 4, rowsPerImage: padded },
        { width: count * padded, height: padded, depthOrArrayLayers: padded },
      )
    })
  }
}

type BrickWriter = ReturnType<typeof brickWriter>

/** Everything a streamer holds between calls. */
interface StreamerState {
  readonly device: GPUDevice
  readonly data: VolumetricLightmapData
  readonly options: CellStreamerOptions
  readonly table: Map<string, VolumetricLightmapCell>
  readonly live: Uint8Array
  readonly grid: ReturnType<typeof indirectionGrid>
  readonly writeRun: BrickWriter
  readonly free: number[]
  readonly loaded: Map<string, number[]>
  readonly pending: Map<string, AbortController>
  wanted: Set<string>
  /** Cells not asked again: the room could not hold them (until a cell is let go), or their read failed. */
  readonly roomless: Set<string>
  readonly failed: Set<string>
  told: boolean
  readonly watch: ReachWatch
  /** The cells along each axis, and the extent of one cell. */
  readonly cells: number[]
  readonly side: number[]
}

/** Writes the cell's bricks, each run of consecutive slots of a row of the layout in one write. */
function writeRuns(
  writeRun: BrickWriter,
  content: VolumetricLightmapCellData,
  slots: readonly number[],
  base: number,
) {
  // The bricks by slot.
  const order = slots.map((_, i) => i).sort((a, b) => slots[a] - slots[b])
  let first = 0
  for (let i = 1; i <= order.length; i++) {
    const rank = base + slots[order[i - 1]]
    const joins =
      i < order.length &&
      slots[order[i]] === slots[order[i - 1]] + 1 &&
      (rank + 1) % VOLUMETRIC_LIGHTMAP_MAX_LAYOUT !== 0
    if (joins) continue
    writeRun(content, order, first, i - first, slots)
    first = i
  }
}

/** Points the indirection texels of the cell's bricks at their slots. */
function pointAtSlots(
  live: Uint8Array,
  data: VolumetricLightmapData,
  content: VolumetricLightmapCellData,
  slots: readonly number[],
  base: number,
) {
  const [width, height] = data.indirectionSize
  slots.forEach((slot, i) => {
    const [x, y, z] = content.positions.subarray(i * 3, i * 3 + 3)
    const at = ((z * height + y) * width + x) * 4
    const [px, py, pz] = brickPlace(base + slot)
    live[at] = px
    live[at + 1] = py
    live[at + 2] = pz
    live[at + 3] = 1
  })
}

function uploadCell(
  s: StreamerState,
  cell: VolumetricLightmapCell,
  content: VolumetricLightmapCellData,
  slots: number[],
) {
  writeRuns(s.writeRun, content, slots, s.options.base)
  pointAtSlots(s.live, s.data, content, slots, s.options.base)
  s.grid.publish(cell.coordinates)
}

function unloadCell(s: StreamerState, key: string) {
  const slots = s.loaded.get(key)
  s.loaded.delete(key)
  if (!slots) return
  s.free.push(...slots)
  const { coordinates } = s.table.get(key)!
  const { low, size } = s.grid.box(coordinates)
  s.grid.copyRows(low, size, s.data.indirection.bytes, s.live, false)
  s.grid.publish(coordinates)
}

function installCell(s: StreamerState, key: string, content: VolumetricLightmapCellData) {
  const cell = s.table.get(key)!
  const count = cell.bricks
  if (count > s.free.length) {
    if (!s.told) s.options.report('volumetric-lightmap-room', { cell: key, bricks: count })
    s.told = true
    s.roomless.add(key)
    return
  }
  const slots = s.free.splice(s.free.length - count, count)
  s.loaded.set(key, slots)
  uploadCell(s, cell, content, slots)
}

function requestCell(s: StreamerState, key: string) {
  const own = new AbortController()
  s.pending.set(key, own)
  s.options
    .read(s.table.get(key)!, own.signal)
    .then((content) => {
      if (s.pending.get(key) === own && s.wanted.has(key)) installCell(s, key, content)
    })
    .catch((error) => {
      if (own.signal.aborted) return
      s.failed.add(key)
      s.options.report('volumetric-lightmap-cell-failed', error)
    })
    .finally(() => {
      if (s.pending.get(key) === own) s.pending.delete(key)
      s.watch.pending = -1
    })
}

/** Whether the cells in reach or the loads in flight changed since the last call; the reach is then
 *  left in `watch.from` and `watch.to`. Allocates nothing. */
function reachMoved(s: StreamerState, eye: ArrayLike<number>, range: number) {
  const { watch, data, side, cells } = s
  const { from, to, lastFrom, lastTo } = watch
  let changed = s.pending.size !== watch.pending || s.free.length !== watch.free
  for (let a = 0; a < 3; a++) {
    from[a] = Math.max(0, Math.floor((eye[a] - range - data.min[a]) / side[a]))
    to[a] = Math.min(cells[a] - 1, Math.floor((eye[a] + range - data.min[a]) / side[a]))
    changed ||= from[a] !== lastFrom[a] || to[a] !== lastTo[a]
  }
  if (!changed) return false
  for (let a = 0; a < 3; a++) {
    lastFrom[a] = from[a]
    lastTo[a] = to[a]
  }
  watch.pending = s.pending.size
  watch.free = s.free.length
  return true
}

/** The cells of the lightmap in the box `watch` holds, nearest to `eye` first. */
function cellsInReach(s: StreamerState, eye: ArrayLike<number>) {
  const { from, to } = s.watch
  const reach: { key: string; distance: number }[] = []
  for (let z = from[2]; z <= to[2]; z++)
    for (let y = from[1]; y <= to[1]; y++)
      for (let x = from[0]; x <= to[0]; x++) {
        const key = `${x},${y},${z}`
        if (!s.table.has(key)) continue
        const centre = [x, y, z].map((c, a) => s.data.min[a] + (c + 0.5) * s.side[a])
        const [dx, dy, dz] = centre.map((c, a) => c - eye[a])
        reach.push({ key, distance: length3(dx, dy, dz) })
      }
  return reach.sort((a, b) => a.distance - b.distance)
}

/** Loads the cells within `range` of `eye`, nearest first, and lets go of the others. */
function updateCells(s: StreamerState, eye: ArrayLike<number>, range: number) {
  if (!reachMoved(s, eye, range)) return
  const reach = cellsInReach(s, eye)
  s.wanted = new Set(reach.map((r) => r.key))
  for (const key of [...s.loaded.keys()])
    if (!s.wanted.has(key)) {
      unloadCell(s, key)
      s.roomless.clear()
    }
  for (const [key, own] of s.pending)
    if (!s.wanted.has(key)) {
      own.abort()
      s.pending.delete(key)
    }
  for (const { key } of reach) {
    if (s.pending.size >= IN_FLIGHT) break
    if (!s.loaded.has(key) && !s.pending.has(key) && !s.roomless.has(key) && !s.failed.has(key))
      requestCell(s, key)
  }
}

/** The streamer of the cells of `data` into the textures of its lightmap. */
export function createCellStreamer(
  device: GPUDevice,
  data: VolumetricLightmapData,
  options: CellStreamerOptions,
) {
  const { texels, list } = data.cells!
  const { textures, room, base } = options
  const live = new Uint8Array(data.indirection.bytes)
  const s: StreamerState = {
    device,
    data,
    options,
    table: new Map(list.map((cell) => [cell.coordinates.join(), cell])),
    live,
    grid: indirectionGrid(device, data, textures[0], live, texels),
    writeRun: brickWriter(device, textures, base, paddedBrickSide(data.brickSize)),
    free: Array.from({ length: room }, (_, k) => room - 1 - k),
    loaded: new Map(),
    pending: new Map(),
    wanted: new Set(),
    roomless: new Set(),
    failed: new Set(),
    told: false,
    watch: {
      from: [0, 0, 0],
      to: [0, 0, 0],
      lastFrom: [0, 0, 0],
      lastTo: [0, 0, 0],
      pending: -1,
      free: -1,
    },
    cells: axes((a) => ceilDiv(data.indirectionSize[a], texels)),
    side: axes((a) => ((data.max[a] - data.min[a]) / data.indirectionSize[a]) * texels),
  }
  return {
    /** Loads the cells within `range` of `eye`, nearest first, and lets go of the others. Cheap when
     *  neither the cells in reach nor the loads in flight changed since the last call: it then
     *  allocates nothing. */
    update: (eye: ArrayLike<number>, range: number) => updateCells(s, eye, range),
    /** Bricks the loaded cells hold. */
    get resident() {
      return room - s.free.length
    },
    dispose() {
      for (const own of s.pending.values()) own.abort()
      s.pending.clear()
      s.loaded.clear()
    },
  }
}
