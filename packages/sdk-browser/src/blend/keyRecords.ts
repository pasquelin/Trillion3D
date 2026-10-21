import {
  KEY_DRAWN,
  KEY_FILED,
  KEY_HAS_BOX,
  KEY_RECORD_WORDS,
  KEY_TRANSMITS,
  KEY_WORD,
  PRIORITY_BIAS,
} from './keyLayout.ts'
import { notDrawn } from '../placement/hidden.ts'
import { rowCell } from '../geometry/partition/rowCells.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { ACTOR_ROW } from '../geometry/dag/worlds/worldLinks.ts'
import type { WebgpuBlendState } from './state.ts'

const RECORD_DOUBLES = KEY_RECORD_WORDS / 2

/** The slot of the word of cell file `file` of world instance `instance` (`WorldCells.fileSlot`),
 *  -1 while the cut gives it none. */
export type FileSlots = (instance: number, file: number) => number

/**
 * WHAT THE KERNELS KNOW OF AN ITEM (`keyLayout.ts`): the six doubles of its world box, or the three
 * of its world origin when it has none, then its flags — a box, drawn, transmissive, in a cell file
 * —, its sort priority, the HLOD 0 cell its row lies in with its world instance, and the slot of its
 * cell file's word as `slots` gives it, `NO_INDEX` for none. Drawn as `notDrawn` reads it; whether
 * its file or its HLOD 0 cell draws its placements is their words, read by the verdict on the GPU
 * (`verdict/verdictWgsl.ts`). The doubles are copied bit for bit: the order and the frustum verdict
 * compute on the CPU's numbers.
 *
 * A row of an instance the cut does not pack — `instance` at `instances` or past — has no state
 * word to read: its instance is `NO_INDEX`. As the descent links it (`setLink`), a row of the
 * placements stands unlinked — no cell, no file, not filed: drawn —, a row of a cell's actor keeps
 * its cell and draws nothing.
 */
function writeKeyRecord(
  blendState: WebgpuBlendState,
  i: number,
  slots?: FileSlots,
  instances = Infinity,
) {
  const item = blendState.blendGpu[i],
    at = i * RECORD_DOUBLES,
    packed = blendState.keyPacked,
    words = blendState.keyWords,
    box = item.bounds,
    base = i * KEY_RECORD_WORDS,
    placement = item.placement,
    cell = placement && rowCell(placement.rows, placement.index)
  if (box) packed.set(box, at)
  else {
    const m = item.matrix.elements
    packed[at] = m[12]
    packed[at + 1] = m[13]
    packed[at + 2] = m[14]
  }
  const unpacked = !!cell && cell.instance >= instances,
    unlinked = unpacked && cell.actor === undefined
  const flags =
    (box ? KEY_HAS_BOX : 0) |
    (notDrawn(item) ? 0 : KEY_DRAWN) |
    (item.transmissive ? KEY_TRANSMITS : 0) |
    (cell && !unlinked ? KEY_FILED : 0)
  const slot = cell && slots && !unpacked ? slots(cell.instance, cell.cell) : -1
  words[base + KEY_WORD.flags] = flags
  words[base + KEY_WORD.priority] = item.priority + PRIORITY_BIAS
  // A row of a cell's instanced actor names that cell as its actor's (`ACTOR_ROW`).
  words[base + KEY_WORD.cell] =
    !cell || unlinked
      ? NO_INDEX
      : cell.actor === undefined
        ? cell.hlod
        : (cell.hlod | ACTOR_ROW) >>> 0
  words[base + KEY_WORD.instance] = unpacked ? NO_INDEX : (cell?.instance ?? 0)
  words[base + KEY_WORD.file] = slot < 0 ? NO_INDEX : slot
  if (!cell) return
  blendState.keyFiled = true
  if (item.transmissive) blendState.cellTransmits = true
}

/**
 * Every record, written with the plan (`refreshBlendScene`): the plan follows every box a matrix
 * move rebuilt and every row a park flipped (the park moves the scene, `engineMovedInPlace`).
 * Between two plans an item's box rewritten by its deformation, or its node hidden or shown, is
 * sent alone (`noteKeyRecord`); a file's slot taken or given back, every record lying in a file is
 * (`noteFileSlots`). The slots are `slots`'s, none without a world, and the instances the cut packs
 * `instances` (`GpuSelection.cellStates`).
 */
export function writeKeyRecords(
  blendState: WebgpuBlendState,
  slots?: FileSlots,
  instances?: number,
) {
  const items = blendState.blendGpu,
    doubles = items.length * RECORD_DOUBLES
  if (blendState.keyPacked.length < doubles) {
    blendState.keyPacked = new Float64Array(doubles)
    blendState.keyWords = new Uint32Array(blendState.keyPacked.buffer)
  }
  blendState.cellTransmits = blendState.keyFiled = false
  for (let i = 0; i < items.length; i++) writeKeyRecord(blendState, i, slots, instances)
  blendState.keyMoved.from = Infinity
  blendState.keyMoved.to = -1
  return blendState.keyWords.subarray(0, items.length * KEY_RECORD_WORDS)
}

/** Item `rank`'s record went stale between two plans: its box or its drawn bit moved. */
export function noteKeyRecord(blendState: WebgpuBlendState, rank: number) {
  const moved = blendState.keyMoved
  if (rank < moved.from) moved.from = rank
  if (rank > moved.to) moved.to = rank
}

/** The slots of the files of `world` (`WorldCells.slotRevision`) stand at `revision`: every record
 *  noted stale when they moved since the records were written and one lies in a file. */
export function noteFileSlots(
  blendState: WebgpuBlendState,
  world: object | undefined,
  revision: number,
) {
  const known = blendState.fileSlots
  if (known.world === world && known.revision === revision) return
  known.world = world
  known.revision = revision
  if (!blendState.keyFiled) return
  noteKeyRecord(blendState, 0)
  noteKeyRecord(blendState, blendState.blendGpu.length - 1)
}

/** The records noted since the last send, written again from their items with `slots`: their
 *  first word and their words, from the first noted to the last; none when none was. A cell or a
 *  file switch notes none: the verdict reads their words itself. */
export function writeMovedKeyRecords(
  blendState: WebgpuBlendState,
  slots?: FileSlots,
  instances?: number,
) {
  const count = blendState.blendGpu.length,
    moved = blendState.keyMoved,
    { from } = moved,
    to = Math.min(moved.to, count - 1)
  moved.from = Infinity
  moved.to = -1
  if (to < from) return undefined
  for (let i = from; i <= to; i++) writeKeyRecord(blendState, i, slots, instances)
  return {
    first: from * KEY_RECORD_WORDS,
    words: blendState.keyWords.subarray(from * KEY_RECORD_WORDS, (to + 1) * KEY_RECORD_WORDS),
  }
}
