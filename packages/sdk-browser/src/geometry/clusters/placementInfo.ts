import { createChangedRuns } from '../residency/ranges.ts'
import type { DeformationOutput } from '../selection/types.ts'
import type { RootOffsetRow } from '../rows/page/offsetRow.ts'
import { deformCountWord, deformOutputWord } from '../../deformation/outputs.ts'
import {
  NO_OUTPUTS,
  PLACEMENT_EVALUATE,
  PLACEMENT_HLOD_SHIFT,
  PLACEMENT_INFO,
  PLACEMENT_INFO_BYTES,
  PLACEMENT_INFO_WORDS,
  PLACEMENT_OBJECT_BITS,
  PLACEMENT_VELOCITY,
} from '../dag/info/placementInfoLayout.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'

/** What the placement records are made from, read when a record is made. */
export type PlacementInfoSource = {
  /** The float-pool record of placement `rank`'s deformation plus one, zero for none. */
  deformWord(rank: number): number
  /** The offset switches of the object of placement `rank`, none for the defaults. */
  offsets(rank: number): RootOffsetRow | undefined
  /** The HLOD index placement `rank` draws as (`drawnAsHlod`). */
  hlod(rank: number): number
  /** What a page's index adds to reach its cluster record, and the placement's first page. */
  infoShift(rank: number): number
  pageBase(rank: number): number
  /** The deformed results of the placement's pages, by the page's rank in it (`ClusterRoot.deformationOutputs`). */
  outputs(rank: number): readonly (DeformationOutput | undefined)[] | undefined
  /** The pages placement `rank` holds. */
  pageCount(rank: number): number
}

/** What the tables hold: the records' words and floats, the results, and what is to be sent. */
interface InfoTables {
  /** What the records are made from, bound once the session that holds them exists (`bind`). */
  source: PlacementInfoSource
  words: Uint32Array<ArrayBuffer>
  // The same words as floats, one view for every record: replaced with `words` when they grow.
  floats: Float32Array
  count: number
  outputs: Uint32Array<ArrayBuffer>
  outputsBase: Int32Array
  outputsUsed: number
  dirty: ReturnType<typeof createChangedRuns>
  outputsDirty: boolean
  grown: boolean
}

const at = PLACEMENT_INFO.at

const fit = (s: InfoTables, placements: number) => {
  if (placements <= s.count) return
  const capacity = grownLength(s.words.length / PLACEMENT_INFO_WORDS, placements)
  const next = new Uint32Array(capacity * PLACEMENT_INFO_WORDS)
  next.set(s.words)
  s.words = next
  s.floats = new Float32Array(next.buffer)
  const bases = new Int32Array(capacity).fill(-1)
  bases.set(s.outputsBase)
  s.outputsBase = bases
  s.count = placements
  s.grown = true
}

/** Placement `rank`'s record made from its sources. */
const make = (s: InfoTables, rank: number) => {
  const { source, words, floats } = s
  const base = rank * PLACEMENT_INFO_WORDS
  const object = source.offsets(rank)
  // The defaults of the switches: evaluated, a motion, never stopped by the distance.
  const evaluate = object?.evaluate ?? true,
    velocity = object?.velocity ?? true
  words[base + at.deform] = source.deformWord(rank)
  words[base + at.switches] =
    (evaluate ? PLACEMENT_EVALUATE : 0) |
    (velocity ? PLACEMENT_VELOCITY : 0) |
    ((object?.bits ?? 0) & PLACEMENT_OBJECT_BITS) |
    (source.hlod(rank) << PLACEMENT_HLOD_SHIFT)
  floats[base + at.wpoDisableSq] = (object?.disable ?? 0) ** 2
  floats[base + at.wpoMost] = object?.most ?? 0
  for (let a = 0; a < 3; a++) floats[base + at.wpoCentre + a] = object?.centre[a] ?? 0
  words[base + at.outputs] = s.outputsBase[rank] >= 0 ? s.outputsBase[rank] : NO_OUTPUTS
  words[base + at.infoShift] = source.infoShift(rank)
  words[base + at.pageBase] = source.pageBase(rank)
  words[base + at.customDepth] = object?.customDepth ?? 0
}

/** The deformed results of every placement laid out again, two words a page, the placements that
 *  deform none holding none. */
const layOutputs = (s: InfoTables, placements: number) => {
  const { source, outputsBase } = s
  let used = 0
  for (let rank = 0; rank < placements; rank++) {
    const list = source.outputs(rank)
    outputsBase[rank] = list?.some(Boolean) ? used : -1
    if (outputsBase[rank] >= 0) used += 2 * source.pageCount(rank)
  }
  if (s.outputs.length < used) s.outputs = new Uint32Array(Math.max(used, 2 * s.outputs.length))
  const { outputs } = s
  for (let rank = 0; rank < placements; rank++) {
    const list = source.outputs(rank),
      base = outputsBase[rank]
    if (base < 0) continue
    for (let page = 0; page < source.pageCount(rank); page++) {
      outputs[base + 2 * page] = deformCountWord(list?.[page])
      outputs[base + 2 * page + 1] = deformOutputWord(list?.[page])
    }
  }
  s.outputsUsed = used
  s.outputsDirty = true
}

/** Every placement's record marked to be made again. */
const markRange = (s: InfoTables, placements: number) => {
  for (let rank = 0; rank < placements; rank++) s.dirty.mark(rank)
}

/** The records sent to `buffer`, whole when `whole` or the table grew, else the runs marked; the
 *  results to `outputBuffer` likewise. */
const flushInfo = (
  s: InfoTables,
  device: GPUDevice,
  buffer: GPUBuffer,
  outputBuffer: GPUBuffer,
  whole: boolean,
) => {
  if (whole || s.grown) {
    markRange(s, s.count)
    s.outputsDirty = true
  }
  s.grown = false
  flushRecords(s, device, buffer)
  if (s.outputsDirty && s.outputsUsed * 4 <= outputBuffer.size) {
    if (s.outputsUsed)
      device.queue.writeBuffer(outputBuffer, 0, s.outputs.subarray(0, s.outputsUsed))
    s.outputsDirty = false
  }
}

/** The tables fitted to `placements`, their results laid out again and every record marked. */
const remakeAll = (s: InfoTables, placements: number) => {
  fit(s, placements)
  layOutputs(s, placements)
  markRange(s, placements)
}

/** The records marked made and written to `buffer`, run by run. */
const flushRecords = (s: InfoTables, device: GPUDevice, buffer: GPUBuffer) => {
  const { count: runs, pairs } = s.dirty.runs()
  for (let r = 0; r < runs; r++) {
    const first = pairs[r * 2],
      last = pairs[r * 2 + 1]
    for (let rank = first; rank <= last; rank++) make(s, rank)
    const bytes = (last - first + 1) * PLACEMENT_INFO_BYTES
    // The caller sized the buffer to the table (`placementTables.ts`): a run past its end is a
    // broken invariant, and stays marked.
    if (first * PLACEMENT_INFO_BYTES + bytes > buffer.size)
      throw new RangeError(
        `Placement records ${first}..${last} lie past the info buffer (${buffer.size} bytes).`,
      )
    device.queue.writeBuffer(
      buffer,
      first * PLACEMENT_INFO_BYTES,
      s.words.subarray(first * PLACEMENT_INFO_WORDS, (last + 1) * PLACEMENT_INFO_WORDS),
    )
  }
  s.dirty.clear()
}

/**
 * THE PLACEMENTS' RECORDS and the deformed results of their pages, as the GPU reads them
 * (`../dag/info/placementInfoLayout.ts`): kept on the host, sent in runs when marked
 * (`mark`, `flush`), made from the session's sources once they are bound (`bind`). A placement is marked when it is made or when anything its record holds
 * changed; its results are laid out again with it. Both tables grow with the placements by the one
 * growth rule, sent whole when they grew.
 */
export function createPlacementInfo() {
  const words = new Uint32Array(PLACEMENT_INFO_WORDS)
  const s: InfoTables = {
    source: undefined as unknown as PlacementInfoSource,
    words,
    floats: new Float32Array(words.buffer),
    count: 0,
    outputs: new Uint32Array(2),
    outputsBase: new Int32Array(1).fill(-1),
    outputsUsed: 0,
    dirty: createChangedRuns(),
    outputsDirty: true,
    grown: true,
  }
  return {
    /** What the records are made from: bound before the first record is made. */
    bind(next: PlacementInfoSource) {
      s.source = next
    },
    /** The tables hold room for `placements`: a table that grew is sent whole at the next flush. */
    ensure: (placements: number) => fit(s, placements),
    /** Placement `rank` made or changed: its record is made again and sent at the next flush. */
    mark(rank: number) {
      fit(s, rank + 1)
      s.dirty.mark(rank)
    },
    /** The placements `[0, placements)` all made again, their results laid out again. */
    markAll: (placements: number) => remakeAll(s, placements),
    /** The results of the placements laid out again: a root's deformation started or stopped, the
     *  float pool's tail moved. Every placement's record is made again, those that hold a base. */
    layOut: (placements: number) => remakeAll(s, placements),
    /** The records sent to `buffer`, whole when `buffer` is another than the last (or the table
     *  grew), else the runs marked; the results to `outputBuffer` likewise. Returns whether a
     *  buffer is to be made larger: the capacity in placements, or in result words, it wants. */
    flush: (device: GPUDevice, buffer: GPUBuffer, outputBuffer: GPUBuffer, whole: boolean) =>
      flushInfo(s, device, buffer, outputBuffer, whole),
    /** Placements the table holds room for, and the words the results take. */
    get capacity() {
      return s.words.length / PLACEMENT_INFO_WORDS
    },
    get outputWords() {
      return s.outputsUsed
    },
    get hostBytes() {
      return s.words.byteLength + s.outputs.byteLength + s.outputsBase.byteLength
    },
  }
}
