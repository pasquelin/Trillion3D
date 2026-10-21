import { createWorldOrigins } from './worlds/worldOrigins.ts'
import type { PackedDag } from './types.ts'
import { FRAME_ROW_WORDS } from './types.ts'
import { primitiveWordAt } from './worlds/worlds.ts'
import { dagGroupEntries } from './shader/bindings.ts'
import { writeRanges } from './runWrites.ts'
import { createChangedRuns, type ChangedRuns } from '../residency/ranges.ts'
import {
  createRecordTexture,
  type RecordTexture,
  type TextureMaker,
} from '../../gpu/core/recordTexture.ts'
import { WORLD_TABLE } from './worlds/worldTable.ts'
import { FRAME_TABLE } from './frameTable.ts'
import { createPreviousPoses } from './previousPoses.ts'

/**
 * A camera cut's frame words and worlds, each one record table whatever the world's size
 * (`frameTable.ts`, `worlds/worldTable.ts`), made by `make` — the cut's admission (`resources.ts`) —, read
 * and written in place by every pass. The host keeps its rows whole (`frameData`, indexed by
 * placement); each write lands at the placement's record. No work per frame: a write follows a
 * change. Beside them, the poses the previous image drew (`previousPoses.ts`): the one copy of the
 * worlds, a pose at a time, those that moved.
 */
export function createCameraFrames(
  device: GPUDevice,
  frameData: Float32Array<ArrayBuffer>,
  worldCount: number,
  worlds: Float32Array,
  sources: PackedDag['worldSources'],
  make?: TextureMaker,
) {
  // Worlds: written by the host and by the composition of the poses
  // (`../../placement/compose/gpuComposeWgsl.ts`). Frame words: their rows written by the host, their stretch by the root
  // boxes pass alone (`../../placement/roots/rootBoxesWgsl.ts`).
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
    pending: createChangedRuns(),
  }
  const origins = createWorldOrigins(worldCount, f.worlds.target('Origin'), sources)
  // The worlds and their exact translations first: the poses the previous image drew start as them.
  writeSpan(f, f.worlds, 'Matrix', worlds, 16, 0, Infinity)
  origins.write()
  const previous = createPreviousPoses(device, f.worlds, worldCount, make)
  const table = {
    /** The placements' frame words (`frameTable.ts`): the cut's kernels, the tree's leaves and
     *  refit read them, the root boxes pass writes their stretch. */
    rows: f.rows,
    /** The placements' record table (`worlds/worldTable.ts`): the one every pass reads, the composition
     *  writes and the proxy's instances grow (`proxy/proxyInstances.ts`). */
    worlds: f.worlds,
    /** Every placement's exact translation — or those of `named`, increasing —, its doubles to
     *  its record, where each cut reads it at its own eye (`shader/worldPoseWgsl.ts`); those that
     *  moved (`createWorldOrigins`). */
    writeWorldOrigins: (named?: Int32Array) => origins.write(named),
    /** Placement `row`'s translation as the GPU no longer holds it: its next write sends it. */
    forgetOrigin: (row: number) => origins.forget(row),
    originBytes: origins.hostBytes,
    /** The poses the previous image drew (`previousPoses.ts`): placements made take theirs at once,
     *  those a send or a composition moved are kept by the next image. */
    previous,
    /** The cut's group: `group`, with the frame words, the worlds and the previous poses as they
     *  stand. */
    bindGroup: (layout: GPUBindGroupLayout, group: DagGroup) =>
      device.createBindGroup({
        layout,
        entries: dagGroupEntries({
          ...group,
          frames: f.rows.view,
          worlds: f.worlds.view,
          previous: previous.table.view,
        }),
      }),
    /** The host rows of placements `[from, to)` — every one by default — to their records. */
    writeRows: (from = 0, to = Infinity) =>
      writeSpan(f, f.rows, 'Row', f.frameData, FRAME_ROW_WORDS, from, to),
    /** The world matrices in `next` of placements `[from, to)` — every one by default —, to
     *  their records. */
    writeWorlds: (next: Float32Array, from = 0, to = Infinity) =>
      writeSpan(f, f.worlds, 'Matrix', next, 16, from, to),
    /** The world matrices in `next` of the `count` increasing placements of `named`: the ones a
     *  call moved, each run to its records (`writeRanges`). */
    writeNamedWorlds: (next: Float32Array, named: Int32Array, count: number) =>
      writeNamedRuns(f.worlds, 'Matrix', next, 16, named, count),
    /** Word `slot` of placement `w`'s frame words, set in the host's row; its record receives the
     *  row at the next `flushWords`. */
    writeWord: (w: number, slot: number, value: number) => writeWord(f, w, slot, value),
    /** The rows a word was written in since the last flush, each run to its records by the cut's
     *  one run writer (`writeRanges`): a row is the host's words alone. Nothing when no word was
     *  written. */
    flushWords: () => flushWords(f),
  }
  table.writeRows()
  return table
}

type Frames = {
  frameData: Float32Array<ArrayBuffer>
  frameInts: Uint32Array<ArrayBuffer>
  worldCount: number
  rows: RecordTexture
  worlds: RecordTexture
  /** The placements whose row holds a word not yet sent. */
  pending: ChangedRuns
}

/** The `count` increasing placements of `named` of `data`, `stride` words each, to field
 *  `field` of `table`, each run to its records (`writeRanges`). */
function writeNamedRuns(
  table: RecordTexture,
  field: string,
  data: Float32Array,
  stride: number,
  named: Int32Array,
  count: number,
) {
  writeRanges(table.target(field), named, count, { data, sourceBase: 0, targetBase: 0, stride })
}

/** Placements `[from, to)` of `data`, `stride` words each, to field `field` of `table`: one
 *  write, within the placements and the words `data` holds. */
function writeSpan(
  f: Frames,
  table: RecordTexture,
  field: string,
  data: Float32Array,
  stride: number,
  from: number,
  to: number,
) {
  const count = Math.min(to, f.worldCount, data.length / stride) - from
  if (count <= 0) return
  table.write(field, from, count, data.buffer as ArrayBuffer, data.byteOffset + from * stride * 4)
}

/** A word staged: it goes up at the next flush, before any cut reads it. */
function writeWord(f: Frames, w: number, slot: number, value: number) {
  f.frameInts[primitiveWordAt(w) + slot] = value
  f.pending.mark(w)
}

function flushWords(f: Frames) {
  if (!f.pending.count) return
  const named = f.pending.take()
  writeNamedRuns(f.rows, 'Row', f.frameData, FRAME_ROW_WORDS, named, named.length)
}
export type CameraFrames = ReturnType<typeof createCameraFrames>
/** A cut's group without the record tables it binds (`dagGroupEntries`). */
export type DagGroup = Omit<Parameters<typeof dagGroupEntries>[0], 'frames' | 'worlds' | 'previous'>
