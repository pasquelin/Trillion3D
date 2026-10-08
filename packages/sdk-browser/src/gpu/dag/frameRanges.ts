import { createWorldOrigins, WORLD_ORIGIN_BYTES } from './worldOrigins.ts'
import type { PackedDag } from './types.ts'
import { uniformSlots, type UniformSlots } from '../../residency/pools.ts'
import { FRAME_VEC4 } from './types.ts'
import { primitiveWordAt } from './worlds.ts'
import { dagGroupEntries } from './shader/bindings.ts'
import { PRIMITIVE_BYTES, cameraFrameRanges } from './cameraRanges.ts'
import { writeRanges } from './split.ts'
import { createSortedKeys, takeSorted, type SortedKeys } from '../../webgpu/cut/denseKeys.ts'
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
  sources: PackedDag['worldSources'],
) {
  const ranges = cameraFrameRanges(device.limits, worldCount),
    slots = uniformSlots(device.limits, ranges.length, 2)
  const f: Frames = {
    ...{ device, frameData, ranges, per: ranges[0].count },
    ...rangeBuffers(device, slots, ranges, own),
    frameInts: new Uint32Array(frameData.buffer, frameData.byteOffset, frameData.length),
    pending: createSortedKeys(),
  }
  const { buffers, worldBuffers, bounds } = f
  const origins = createWorldOrigins(device, ranges, worldBuffers, sources)
  /** Range `r`'s bind group: `group`, its `frames`, its `worlds`, its `range`. */
  const bindGroup = (layout: GPUBindGroupLayout, group: DagGroup, r: number) =>
    device.createBindGroup({
      layout,
      entries: dagGroupEntries(
        { ...group, frames: buffers[r], worlds: worldBuffers[r] },
        { buffer: bounds, offset: slots.offset(r)[0], size: 16 },
      ),
    })
  const table = {
    ranges,
    buffers,
    worldBuffers,
    /** Every placement's exact translation — or those of `named`, increasing —, its doubles to
     *  its range, where each cut reads it at its own eye (`shader/worldPoseWgsl.ts`); those that
     *  moved (`createWorldOrigins`). */
    writeWorldOrigins: (named?: Int32Array) => origins.write(named),
    /** Placement `row`'s translation as the GPU no longer holds it: its next write sends it. */
    forgetOrigin: (row: number) => origins.forget(row),
    originBytes: origins.hostBytes,
    bindGroup,
    /** One bind group per range (`bindGroup`), with its primitive count. */
    bindGroups: (layout: GPUBindGroupLayout, group: DagGroup) =>
      ranges.map(({ first, count }, r) => ({
        first,
        count,
        bindGroup: bindGroup(layout, group, r),
      })),
    /** The host rows of primitives `[from, to)` — every one by default —, each to its range's
     *  buffer at its row. `dagPrepare` writes the rest. */
    writeRows: (from = 0, to = Infinity) => writeRows(f, from, to),
    /** The host rows of the `count` increasing primitives of `named`, each run to its range. */
    writeNamedRows: (named: Int32Array, count: number) =>
      writeNamed(f, f.buffers, ROW_FLOATS, f.frameData, named, count),
    /** Every primitive's world matrix in `next`, each to its range's `worlds`. */
    /** The world matrices in `next` of primitives `[from, to)` — every one by default —, each run
     *  to its range. */
    writeWorlds: (next: Float32Array, from = 0, to = Infinity) => writeWorlds(f, next, from, to),
    /** The world matrices in `next` of the `count` increasing primitives of `named`: the ones a
     *  call moved, each run to its range (`writeRanges`). */
    writeNamedWorlds: (next: Float32Array, named: Int32Array, count: number) =>
      writeNamed(f, worldBuffers, 16, next, named, count),
    /** Word `slot` of primitive `w`'s frame words, set in the host's row; its range receives the
     *  row at the next `flushWords`. */
    writeWord: (w: number, slot: number, value: number) => writeWord(f, w, slot, value),
    /** The rows a word was written in since the last flush, each run to its range by the cut's one
     *  run writer (`writeRanges`): their planes are ones `dagPrepare` writes again before any
     *  kernel reads them (`shader/shader.ts`). Nothing when no word was written. */
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
  /** Primitives of a full range: the first range a word lands in is found by division. */
  per: number
  buffers: GPUBuffer[]
  worldBuffers: GPUBuffer[]
  bounds: GPUBuffer
  /** The primitives whose row holds a word not yet sent. */
  pending: SortedKeys
}

/** The `count` increasing primitives of `named`, `stride` words each of `data`, to the buffers
 *  of their ranges, which start at the range's first primitive: one table split in equal parts. */
function writeNamed(
  { device, per }: Frames,
  buffers: GPUBuffer[],
  stride: number,
  data: Float32Array,
  named: Int32Array,
  count: number,
) {
  const parts = { buffers, bytes: per * stride * 4 },
    source = { data, sourceBase: 0, targetBase: 0, stride }
  writeRanges(device, parts, named, count, source)
}

/** Each range's `frames` and `worlds`, and the uniform of every range's `{first, count}`, written
 *  once at its aligned offset. */
function rangeBuffers(
  device: GPUDevice,
  slots: UniformSlots,
  ranges: Frames['ranges'],
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
    size: slots.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const words = new Uint32Array(slots.bytes / 4)
  for (let r = 0; r < ranges.length; r++)
    words.set([ranges[r].first, ranges[r].count], r * slots.strideWords)
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

function writeWorlds(f: Frames, next: Float32Array, from: number, to: number) {
  const { device, ranges, worldBuffers } = f
  for (let r = 0; r < ranges.length; r++) {
    const { first, count } = ranges[r],
      a = Math.max(from, first),
      b = Math.min(to, first + count, next.length / 16)
    if (a < b)
      device.queue.writeBuffer(
        worldBuffers[r],
        (a - first) * WORLD_BYTES,
        next.buffer as ArrayBuffer,
        next.byteOffset + a * WORLD_BYTES,
        (b - a) * WORLD_BYTES,
      )
  }
}

function writeWord({ frameInts, pending }: Frames, w: number, slot: number, value: number) {
  frameInts[primitiveWordAt(w) + slot] = value
  pending.listed.add(w)
}

function flushWords(f: Frames) {
  if (!f.pending.listed.count) return
  const named = takeSorted(f.pending)
  writeNamed(f, f.buffers, ROW_FLOATS, f.frameData, named, named.length)
}
export type CameraFrames = ReturnType<typeof createCameraFrames>
/** A cut's group without its range's own buffers (`dagGroupEntries`). */
type DagGroup = Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>
