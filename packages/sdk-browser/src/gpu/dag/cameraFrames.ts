import { createWorldOrigins } from './worldOrigins.ts'
import type { PackedDag } from './types.ts'
import { FRAME_ROW_WORDS } from './types.ts'
import { primitiveWordAt } from './worlds.ts'
import { worldStretch } from '../../page/selection/rootWorld.ts'
import { dagGroupEntries } from './shader/bindings.ts'
import { writeRanges } from './runWrites.ts'
import { createChangedRuns, type ChangedRuns } from '../../webgpu/residency/ranges.ts'
import { createRecordTexture, type RecordTexture } from '../core/recordTexture.ts'
import { WORLD_TABLE } from './worldTable.ts'
import { FRAME_TABLE } from './frameTable.ts'

/**
 * A camera cut's frame words and worlds, each one record table whatever the world's size
 * (`frameTable.ts`, `worldTable.ts`), made by `make` — the cut's admission (`resources.ts`) —, read
 * and written in place by every pass and copied by none. The host keeps its rows whole
 * (`frameData`, indexed by placement); each write lands at the placement's record. No work per
 * frame: a write follows a change.
 */
export function createCameraFrames(
  device: GPUDevice,
  frameData: Float32Array<ArrayBuffer>,
  worldCount: number,
  worlds: Float32Array,
  sources: PackedDag['worldSources'],
  make?: (descriptor: GPUTextureDescriptor, bytes: number) => GPUTexture,
) {
  // Worlds: written by the host and by the composition of the poses
  // (`../../placement/gpuComposeWgsl.ts`), copied once when the proxy's copies outgrow them
  // (`RecordTexture.hold`). Frame words: written by the host and, their stretch, by the root boxes
  // pass (`../../placement/rootBoxesWgsl.ts`).
  const read = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    written = read | GPUTextureUsage.STORAGE_BINDING
  const f: Frames = {
    frameData,
    worldCount,
    rows: createRecordTexture(device, FRAME_TABLE, worldCount, written, make),
    worlds: createRecordTexture(
      device,
      WORLD_TABLE,
      worldCount,
      written | GPUTextureUsage.COPY_SRC,
      make,
    ),
    frameInts: new Uint32Array(frameData.buffer, frameData.byteOffset, frameData.length),
    sources,
    pending: createChangedRuns(),
    writes: 0,
  }
  const origins = createWorldOrigins(worldCount, f.worlds.target('Origin'), sources)
  const table = {
    /** The placements' frame words (`frameTable.ts`): the cut's kernels, the tree's leaves and
     *  refit read them, the root boxes pass writes their stretch. */
    rows: f.rows,
    /** The placements' record table (`worldTable.ts`): the one every pass reads, the composition
     *  writes and the proxy's instances grow (`proxyInstances.ts`). */
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
    /** The cut's group: `group`, with the frame words and the worlds as they stand. */
    bindGroup: (layout: GPUBindGroupLayout, group: DagGroup) =>
      device.createBindGroup({
        layout,
        entries: dagGroupEntries({ ...group, frames: f.rows.view, worlds: f.worlds.view }),
      }),
    /** The host rows of placements `[from, to)` — every one by default — to their records.
     *  `dagPrepare` writes the rest. */
    writeRows: (from = 0, to = Infinity) => writeRows(f, from, to),
    /** The host rows of the `count` increasing placements of `named`, each run to its records. */
    writeNamedRows: (named: Int32Array, count: number) => {
      for (let k = 0; k < count; k++) restretch(f, named[k])
      writeNamed(f, named, count)
    },
    /** The world matrices in `next` of placements `[from, to)` — every one by default —, to
     *  their records. */
    writeWorlds: (next: Float32Array, from = 0, to = Infinity) => writeWorlds(f, next, from, to),
    /** The world matrices in `next` of the `count` increasing placements of `named`: the ones a
     *  call moved, each run to its records (`writeRanges`). */
    writeNamedWorlds: (next: Float32Array, named: Int32Array, count: number) =>
      writeNamedWorlds(f, next, named, count),
    /** Word `slot` of placement `w`'s frame words, set in the host's row; its record receives the
     *  row at the next `flushWords`. */
    writeWord: (w: number, slot: number, value: number) => writeWord(f, w, slot, value),
    /** The rows a word was written in since the last flush, each run to its records by the cut's
     *  one run writer (`writeRanges`): a row is the host's words alone. Nothing when no word was
     *  written. */
    flushWords: () => flushWords(f),
    /** Writes the host made into the frame words, the worlds and their exact translations since
     *  they were made: what a GPU writer of the same words follows (`../../placement/gpuCompose.ts`). */
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
  frameData: Float32Array<ArrayBuffer>
  frameInts: Uint32Array<ArrayBuffer>
  worldCount: number
  /** Each placement's root: what its stretch is taken from (`restretch`). */
  sources: PackedDag['worldSources']
  rows: RecordTexture
  worlds: RecordTexture
  /** The placements whose row holds a word not yet sent. */
  pending: ChangedRuns
  /** Writes sent into the tables above (`writes`). */
  writes: number
}

/** The host rows of the `count` increasing placements of `named`, each run to its records. */
function writeNamed(f: Frames, named: Int32Array, count: number) {
  if (count) f.writes++
  const source = { data: f.frameData, sourceBase: 0, targetBase: 0, stride: FRAME_ROW_WORDS }
  writeRanges(f.rows.target('Row'), named, count, source)
}

function writeRows(f: Frames, from: number, to: number) {
  const rows = Math.min(to, f.worldCount) - from
  if (rows <= 0) return
  for (let w = from; w < from + rows; w++) restretch(f, w)
  f.writes++
  const { frameData } = f
  f.rows.write(
    'Row',
    from,
    rows,
    frameData.buffer,
    frameData.byteOffset + primitiveWordAt(from) * 4,
  )
}

function writeWorlds(f: Frames, next: Float32Array, from: number, to: number) {
  const worlds = Math.min(to, f.worldCount, next.length / 16) - from
  if (worlds <= 0) return
  f.writes++
  f.worlds.write('Matrix', from, worlds, next.buffer as ArrayBuffer, next.byteOffset + from * 64)
}

/** The world matrices in `next` of the `count` increasing placements of `named`, each run to its
 *  records (`writeRanges`). */
function writeNamedWorlds(f: Frames, next: Float32Array, named: Int32Array, count: number) {
  if (count) f.writes++
  const source = { data: next, sourceBase: 0, targetBase: 0, stride: 16 }
  writeRanges(f.worlds.target('Matrix'), named, count, source)
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
  writeNamed(f, named, named.length)
}

/** Placement `w`'s stretch in its host row, as its world stands — the one memo of it
 *  (`worldStretch`) — before the row goes up: a row the host sends never takes back a stretch the
 *  GPU wrote since its world moved (`../../placement/rootBoxes.ts`). */
function restretch(f: Frames, w: number) {
  const source = f.sources[w]
  if (source) f.frameData[primitiveWordAt(w)] = worldStretch(source)
}
export type CameraFrames = ReturnType<typeof createCameraFrames>
/** A cut's group without the record tables it binds (`dagGroupEntries`). */
type DagGroup = Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds'>
