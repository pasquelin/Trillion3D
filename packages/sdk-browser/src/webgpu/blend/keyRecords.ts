import {
  KEY_DRAWN,
  KEY_HAS_BOX,
  KEY_RECORD_WORDS,
  KEY_TRANSMITS,
  KEY_WORD,
  PRIORITY_BIAS,
} from './keyLayout.ts'
import { notDrawn } from '../../placement/hidden.ts'
import { rowCell } from '../../partition/rowCells.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import type { WebgpuBlendState } from './state.ts'

const RECORD_DOUBLES = KEY_RECORD_WORDS / 2

/**
 * WHAT THE KERNELS KNOW OF AN ITEM (`keyLayout.ts`): the six doubles of its world box, or the three
 * of its world origin when it has none, then its flags — a box, drawn, transmissive —, its sort
 * priority, and the HLOD 0 cell its row lies in with its world instance, `NO_INDEX` for none. Drawn
 * as `notDrawn` reads it; whether that cell draws its placements is the cell's state word, read by
 * the verdict on the GPU (`verdictWgsl.ts`). The doubles are copied bit for bit: the order and the
 * frustum verdict compute on the CPU's numbers.
 */
function writeKeyRecord(blendState: WebgpuBlendState, i: number) {
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
  const flags =
    (box ? KEY_HAS_BOX : 0) |
    (notDrawn(item) ? 0 : KEY_DRAWN) |
    (item.transmissive ? KEY_TRANSMITS : 0)
  words[base + KEY_WORD.flags] = flags
  words[base + KEY_WORD.priority] = item.priority + PRIORITY_BIAS
  words[base + KEY_WORD.cell] = cell ? cell.hlod : NO_INDEX
  words[base + KEY_WORD.instance] = cell?.instance ?? 0
  if (cell && item.transmissive) blendState.cellTransmits = true
}

/**
 * Every record, written with the plan (`refreshBlendScene`): the plan follows every box a matrix
 * move rebuilt and every row a park flipped (the park moves the scene, `engineMovedInPlace`).
 * Between two plans an item's box rewritten by its deformation, or its node hidden or shown, is
 * sent alone (`noteKeyRecord`).
 */
export function writeKeyRecords(blendState: WebgpuBlendState) {
  const items = blendState.blendGpu,
    doubles = items.length * RECORD_DOUBLES
  if (blendState.keyPacked.length < doubles) {
    blendState.keyPacked = new Float64Array(doubles)
    blendState.keyWords = new Uint32Array(blendState.keyPacked.buffer)
  }
  blendState.cellTransmits = false
  for (let i = 0; i < items.length; i++) writeKeyRecord(blendState, i)
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

/** The records noted since the last send, written again from their items: their first word and
 *  their words, from the first noted to the last; none when none was. A cell switch notes none:
 *  the verdict reads the cell's state word itself. */
export function writeMovedKeyRecords(blendState: WebgpuBlendState) {
  const count = blendState.blendGpu.length,
    moved = blendState.keyMoved,
    { from } = moved,
    to = Math.min(moved.to, count - 1)
  moved.from = Infinity
  moved.to = -1
  if (to < from) return undefined
  for (let i = from; i <= to; i++) writeKeyRecord(blendState, i)
  return {
    first: from * KEY_RECORD_WORDS,
    words: blendState.keyWords.subarray(from * KEY_RECORD_WORDS, (to + 1) * KEY_RECORD_WORDS),
  }
}
