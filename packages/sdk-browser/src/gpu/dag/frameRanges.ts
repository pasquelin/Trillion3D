import { createWorldOrigins } from './worldOrigins.ts'
import type { PackedDag } from './types.ts'
import { uniformSlots, type UniformSlots } from '../../residency/pools.ts'
import { FRAME_VEC4 } from './types.ts'
import { primitiveWordAt } from './worlds.ts'
import { worldStretch } from '../../page/selection/rootWorld.ts'
import { dagGroupEntries } from './shader/bindings.ts'
import { PRIMITIVE_BYTES, cameraFrameRanges } from './cameraRanges.ts'
import { writeParts, writeRanges } from './split.ts'
import { createChangedRuns, type ChangedRuns } from '../../webgpu/residency/ranges.ts'
import { createRecordTexture, type RecordTexture } from '../core/recordTexture.ts'
import { WORLD_TABLE } from './worldTable.ts'
/** Floats of one host row (`primitiveFrameWords`). */
const ROW_FLOATS = FRAME_VEC4 * 4

/**
 * A camera cut's `frames`, one buffer per range (`cameraFrameRanges`), and the uniform that tells
 * each bind group its range: `{first, count}` at the range's aligned offset, written once. The
 * host keeps its rows whole (`frameData`, indexed by primitive); each write lands in the range
 * that holds the primitive, at its row there. No work per frame: a write follows a change. The
 * worlds are one record table, every range's (`worldTable.ts`), made by `make` — the cut's
 * admission (`resources.ts`) —, read and written in place by every pass and copied by none.
 */
export function createCameraFrames(
  device: GPUDevice,
  frameData: Float32Array<ArrayBuffer>,
  worldCount: number,
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
  worlds: Float32Array,
  sources: PackedDag['worldSources'],
  make?: (descriptor: GPUTextureDescriptor, bytes: number) => GPUTexture,
) {
  const ranges = cameraFrameRanges(device.limits, worldCount),
    slots = uniformSlots(device.limits, ranges.length, 2)
  // Written by the host and by the composition of the poses (`../../placement/gpuComposeWgsl.ts`).
  const usage =
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING
  const f: Frames = {
    ...{ device, frameData, ranges, per: ranges[0].count },
    ...rangeBuffers(device, slots, ranges, own),
    worlds: createRecordTexture(device, WORLD_TABLE, worldCount, usage, make),
    frameInts: new Uint32Array(frameData.buffer, frameData.byteOffset, frameData.length),
    sources,
    pending: createChangedRuns(),
    writes: 0,
  }
  const { buffers, bounds } = f
  const origins = createWorldOrigins(device, worldCount, f.worlds.target('Origin'), sources)
  /** Range `r`'s bind group: `group`, its `frames`, the worlds, its `range`. */
  const bindGroup = (layout: GPUBindGroupLayout, group: DagGroup, r: number) =>
    device.createBindGroup({
      layout,
      entries: dagGroupEntries(
        { ...group, frames: buffers[r], worlds: f.worlds.view },
        { buffer: bounds, offset: slots.offset(r)[0], size: 16 },
      ),
    })
  const table = {
    ranges,
    buffers,
    /** The worlds' record table (`worldTable.ts`): the one every pass reads and the composition
     *  writes. */
    worlds: f.worlds,
    /** Every placement's exact translation — or those of `named`, increasing —, its doubles to
     *  its record, where each cut reads it at its own eye (`shader/worldPoseWgsl.ts`); those that
     *  moved (`createWorldOrigins`). */
    writeWorldOrigins: (named?: Int32Array) => {
      const sent = origins.write(named)
      if (sent.length) f.writes++
      return sent
    },
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
    writeNamedRows: (named: Int32Array, count: number) => {
      for (let k = 0; k < count; k++) restretch(f, named[k])
      writeNamed(f, f.buffers, ROW_FLOATS, f.frameData, named, count)
    },
    /** The world matrices in `next` of primitives `[from, to)` — every one by default —, to
     *  their records. */
    writeWorlds: (next: Float32Array, from = 0, to = Infinity) => writeWorlds(f, next, from, to),
    /** The world matrices in `next` of the `count` increasing primitives of `named`: the ones a
     *  call moved, each run to its records (`writeRanges`). */
    writeNamedWorlds: (next: Float32Array, named: Int32Array, count: number) =>
      writeNamedWorlds(f, next, named, count),
    /** Word `slot` of primitive `w`'s frame words, set in the host's row; its range receives the
     *  row at the next `flushWords`. */
    writeWord: (w: number, slot: number, value: number) => writeWord(f, w, slot, value),
    /** The rows a word was written in since the last flush, each run to its range by the cut's one
     *  run writer (`writeRanges`): a row is the host's words alone. Nothing when no word was
     *  written. */
    flushWords: () => flushWords(f),
    /** Writes the host made into the frames, the worlds and their exact translations since they
     *  were made: what a GPU writer of the same words follows (`../../placement/gpuCompose.ts`). */
    get writes() {
      return f.writes
    },
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
  /** Each placement's root: what its stretch is taken from (`restretch`). */
  sources: PackedDag['worldSources']
  ranges: ReturnType<typeof cameraFrameRanges>
  /** Primitives of a full range: the first range a word lands in is found by division. */
  per: number
  buffers: GPUBuffer[]
  worlds: RecordTexture
  bounds: GPUBuffer
  /** The primitives whose row holds a word not yet sent. */
  pending: ChangedRuns
  /** Writes sent into the buffers above (`writes`). */
  writes: number
}

/** The `count` increasing primitives of `named`, `stride` words each of `data`, to the buffers
 *  of their ranges, which start at the range's first primitive: one table split in equal parts. */
function writeNamed(
  f: Frames,
  buffers: GPUBuffer[],
  stride: number,
  data: Float32Array,
  named: Int32Array,
  count: number,
) {
  if (count) f.writes++
  const parts = { buffers, bytes: f.per * stride * 4 },
    source = { data, sourceBase: 0, targetBase: 0, stride }
  writeRanges(f.device, parts, named, count, source)
}

/** Each range's `frames`, and the uniform of every range's `{first, count}`, written once at its
 *  aligned offset. */
function rangeBuffers(
  device: GPUDevice,
  slots: UniformSlots,
  ranges: Frames['ranges'],
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer,
) {
  const buffers = ranges.map(({ count }) =>
    own({
      label: 'Trillion3D DAG frames',
      size: count * PRIMITIVE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
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
  return { buffers, bounds }
}

function writeRows(f: Frames, from: number, to: number) {
  const rows = Math.min(to, primitives(f)) - from
  for (let w = from; w < from + rows; w++) restretch(f, w)
  writeSpan(f, f.buffers, ROW_FLOATS, f.frameData, from * ROW_FLOATS, rows * ROW_FLOATS)
}

function writeWorlds(f: Frames, next: Float32Array, from: number, to: number) {
  const worlds = Math.min(to, primitives(f), next.length / 16) - from
  if (worlds <= 0) return
  f.writes++
  f.worlds.write('Matrix', from, worlds, next.buffer as ArrayBuffer, next.byteOffset + from * 64)
}

/** The world matrices in `next` of the `count` increasing primitives of `named`, each run to its
 *  records (`writeRanges`). */
function writeNamedWorlds(f: Frames, next: Float32Array, named: Int32Array, count: number) {
  if (count) f.writes++
  const source = { data: next, sourceBase: 0, targetBase: 0, stride: 16 }
  writeRanges(f.device, f.worlds.target('Matrix'), named, count, source)
}

/** The primitives the ranges hold. */
const primitives = ({ ranges }: Frames) =>
  ranges[ranges.length - 1].first + ranges[ranges.length - 1].count

/** `words` words of `data` from word `fromWord`, into the table `buffers` lays out `strideWords` a
 *  primitive, a range's primitives a buffer: each span into the range that holds it
 *  (`writeParts`). */
function writeSpan(
  f: Frames,
  buffers: GPUBuffer[],
  strideWords: number,
  data: Float32Array,
  fromWord: number,
  words: number,
) {
  if (words <= 0) return
  f.writes++
  const parts = { buffers, bytes: f.per * strideWords * 4 }
  const bytes = data.buffer as ArrayBuffer
  writeParts(f.device, parts, fromWord * 4, bytes, data.byteOffset + fromWord * 4, words * 4)
}

/** A word staged counts as a write from now: it goes up at the next flush, before any cut reads it. */
function writeWord(f: Frames, w: number, slot: number, value: number) {
  f.frameInts[primitiveWordAt(w) + slot] = value
  f.pending.mark(w)
  f.writes++
}

function flushWords(f: Frames) {
  if (!f.pending.count) return
  const named = f.pending.take()
  for (let k = 0; k < named.length; k++) restretch(f, named[k])
  writeNamed(f, f.buffers, ROW_FLOATS, f.frameData, named, named.length)
}

/** Primitive `w`'s stretch in its host row, as its world stands — the one memo of it
 *  (`worldStretch`) — before the row goes up: a row the host sends never takes back a stretch the
 *  GPU wrote since its world moved (`../../placement/rootBoxes.ts`). */
function restretch(f: Frames, w: number) {
  const source = f.sources[w]
  if (source) f.frameData[primitiveWordAt(w)] = worldStretch(source)
}
export type CameraFrames = ReturnType<typeof createCameraFrames>
/** A cut's group without its range's own buffers (`dagGroupEntries`). */
type DagGroup = Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>
