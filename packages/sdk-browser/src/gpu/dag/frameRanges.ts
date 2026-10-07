import { createWorldOrigins, WORLD_ORIGIN_BYTES } from './worldOrigins.ts'
import type { PackedDag } from './types.ts'
import { uniformStride } from '../../residency/pools.ts'
import { FRAME_VEC4 } from './types.ts'
import { primitiveWordAt } from './worlds.ts'
import { dagGroupEntries } from './shader/bindings.ts'
import { PRIMITIVE_BYTES, cameraFrameRanges } from './cameraRanges.ts'
/** Floats of one host row (`primitiveFrameWords`). */
const ROW_FLOATS = FRAME_VEC4 * 4
/** Bytes of one primitive's world matrix in `worlds`. */
const WORLD_BYTES = 64

/** Bytes of one range's `frames`; a range holds at least one primitive. */
export const framesBytes = (count: number) => count * PRIMITIVE_BYTES

/**
 * A camera cut's `frames`, one buffer per range (`cameraFrameRanges`), and the uniform that tells
 * each bind group its range: `{first, count}` at the range's aligned offset, written once. The
 * host keeps its rows whole (`frameData`, indexed by primitive); each write lands in the range
 * that holds the primitive, at its row there. No work per frame: a write follows a change. The
 * world matrices follow the same ranges, one `worlds` buffer each, read at `rowOf(w)`.
 */
export function createCameraFrames(
  device: GPUDevice,
  frameData: Float32Array<ArrayBuffer>,
  worldCount: number,
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  worlds: Float32Array,
  sources?: PackedDag['worldSources'],
) {
  const ranges = cameraFrameRanges(device.limits, worldCount),
    stride = uniformStride(device.limits)
  const f: Frames = {
    ...{ device, frameData, ranges, stride, per: ranges[0].count },
    ...rangeBuffers(device, ranges, stride, own),
    frameInts: new Uint32Array(frameData.buffer, frameData.byteOffset, frameData.length),
    pending: { from: Infinity, to: -1 },
  }
  const { buffers, worldBuffers, bounds } = f
  const origins = createWorldOrigins(device, ranges, worldBuffers, sources)
  /** Range `r`'s bind group: `group`, its `frames`, its `worlds`, its `range`. */
  const bindGroup = (layout: GPUBindGroupLayout, group: DagGroup, r: number) =>
    device.createBindGroup({
      layout,
      entries: dagGroupEntries(
        { ...group, frames: buffers[r], worlds: worldBuffers[r] },
        { buffer: bounds, offset: r * stride, size: 16 },
      ),
    })
  const table = {
    ranges,
    buffers,
    worldBuffers,
    writeWorldOrigins: origins.write,
    originBytes: origins.hostBytes,
    bindGroup,
    /** One bind group per range (`bindGroup`), with its primitive count. */
    bindGroups: (layout: GPUBindGroupLayout, group: DagGroup) =>
      ranges.map(({ count }, r) => ({ count, bindGroup: bindGroup(layout, group, r) })),
    /** The host rows of primitives `[from, to)` — every one by default —, each to its range's
     *  buffer at its row. `dagPrepare` writes the rest. */
    writeRows: (from = 0, to = Infinity) => writeRows(f, from, to),
    /** Every primitive's world matrix in `next`, each to its range's `worlds`. */
    writeWorlds: (next: Float32Array) => writeWorlds(f, next),
    /** Word `slot` of primitive `w`'s frame words, set in the host's row; its range receives it
     *  at the next `flushWords`, with every word written since, as one interval (CPU-15). */
    writeWord: (w: number, slot: number, value: number) => writeWord(f, w, slot, value),
    /**
     * The words written since the last flush, one write per range the interval crosses: the host
     * rows between them hold what their range already holds, or planes `dagPrepare` writes again
     * before any kernel reads them (`shader/shader.ts`). Nothing when no word was written.
     */
    flushWords: () => flushWords(f),
  }
  table.writeRows()
  table.writeWorlds(worlds)
  table.writeWorldOrigins()
  return table
}

type Frames = {
  device: GPUDevice
  frameData: Float32Array<ArrayBuffer>
  frameInts: Uint32Array<ArrayBuffer>
  ranges: ReturnType<typeof cameraFrameRanges>
  stride: number
  /** Primitives of a full range: the first range a word lands in is found by division. */
  per: number
  buffers: GPUBuffer[]
  worldBuffers: GPUBuffer[]
  bounds: GPUBuffer
  /** Words written and not yet sent: one interval, in `frameInts` indices. */
  pending: { from: number; to: number }
}

/** Each range's `frames` and `worlds`, and the uniform of every range's `{first, count}`, written
 *  once at its aligned offset. */
function rangeBuffers(
  device: GPUDevice,
  ranges: Frames['ranges'],
  stride: number,
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
) {
  const buffers = ranges.map(({ count }) =>
    own({
      label: 'Trillion3D DAG frames',
      size: framesBytes(count),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    }),
  )
  const worldBuffers = ranges.map(({ count }) =>
    own({
      label: 'Trillion3D DAG worlds',
      size: count * (WORLD_BYTES + WORLD_ORIGIN_BYTES),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  )
  const bounds = own({
    label: 'Trillion3D DAG frame ranges',
    size: ranges.length * stride,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array((ranges.length * stride) / 4)
  for (let r = 0; r < ranges.length; r++)
    words.set([ranges[r].first, ranges[r].count], (r * stride) / 4)
  device.queue.writeBuffer(bounds, 0, words)
  return { buffers, worldBuffers, bounds }
}

function writeRows({ device, ranges, buffers, frameData }: Frames, from: number, to: number) {
  for (let r = 0; r < ranges.length; r++) {
    const { first, count } = ranges[r],
      a = Math.max(from, first),
      b = Math.min(to, first + count)
    if (a < b)
      device.queue.writeBuffer(
        buffers[r],
        (a - first) * ROW_FLOATS * 4,
        frameData,
        a * ROW_FLOATS,
        (b - a) * ROW_FLOATS,
      )
  }
}

function writeWorlds({ device, ranges, worldBuffers }: Frames, next: Float32Array) {
  for (let r = 0; r < ranges.length; r++) {
    const { first, count } = ranges[r],
      bytes = Math.min(count * WORLD_BYTES, next.byteLength - first * WORLD_BYTES)
    if (bytes > 0)
      device.queue.writeBuffer(
        worldBuffers[r],
        0,
        next.buffer as ArrayBuffer,
        next.byteOffset + first * WORLD_BYTES,
        bytes,
      )
  }
}

function writeWord({ frameInts, pending }: Frames, w: number, slot: number, value: number) {
  const at = primitiveWordAt(w) + slot
  frameInts[at] = value
  if (at < pending.from) pending.from = at
  if (at > pending.to) pending.to = at
}

function flushWords({ device, ranges, buffers, frameInts, pending, per }: Frames) {
  const { from, to } = pending
  if (to < from) return
  pending.from = Infinity
  pending.to = -1
  for (let r = Math.floor(from / ROW_FLOATS / per); r < ranges.length; r++) {
    const start = ranges[r].first * ROW_FLOATS,
      end = start + ranges[r].count * ROW_FLOATS - 1
    if (start > to) break
    const a = Math.max(from, start),
      b = Math.min(to, end)
    device.queue.writeBuffer(buffers[r], (a - start) * 4, frameInts, a, b - a + 1)
  }
}
export type CameraFrames = ReturnType<typeof createCameraFrames>
/** A cut's group without its range's own buffers (`dagGroupEntries`). */
type DagGroup = Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>
