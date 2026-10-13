import { KEY_DRAWN, KEY_HAS_BOX, KEY_RECORD_WORDS, KEY_WORD } from './keyLayout.ts'
import { notDrawn } from '../../placement/hidden.ts'
import { waterRankOf } from '../transparent/transmission.ts'
import type { WebgpuBlendState } from './state.ts'

const RECORD_DOUBLES = KEY_RECORD_WORDS / 2

/**
 * WHAT THE KERNELS KNOW OF AN ITEM (`keyLayout.ts`): the six doubles of its world box, or the three
 * of its world origin when it has none, then its flags — a box, drawn —, its own rank — the rank of
 * its CPU key in the frame data when it draws its own slot (`runs.ts`), `NO_INDEX` otherwise — and
 * its water rank. The doubles are copied bit for bit: the order and the frustum verdict compute on
 * the CPU's numbers.
 */
function writeKeyRecord(blendState: WebgpuBlendState, i: number) {
  const item = blendState.blendGpu[i],
    at = i * RECORD_DOUBLES,
    packed = blendState.keyPacked,
    words = blendState.keyWords,
    box = item.bounds
  if (box) packed.set(box, at)
  else {
    const m = item.matrix.elements
    packed[at] = m[12]
    packed[at + 1] = m[13]
    packed[at + 2] = m[14]
  }
  const flags = (box ? KEY_HAS_BOX : 0) | (notDrawn(item) ? 0 : KEY_DRAWN)
  words[i * KEY_RECORD_WORDS + KEY_WORD.flags] = flags
  words[i * KEY_RECORD_WORDS + KEY_WORD.own] = blendState.ownRanks[i]
  words[i * KEY_RECORD_WORDS + KEY_WORD.water] = waterRankOf(item.flags)
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
 *  their words, from the first noted to the last; none when none was. */
export function writeMovedKeyRecords(blendState: WebgpuBlendState) {
  const moved = blendState.keyMoved,
    { from } = moved,
    to = Math.min(moved.to, blendState.blendGpu.length - 1)
  moved.from = Infinity
  moved.to = -1
  if (to < from) return undefined
  for (let i = from; i <= to; i++) writeKeyRecord(blendState, i)
  return {
    first: from * KEY_RECORD_WORDS,
    words: blendState.keyWords.subarray(from * KEY_RECORD_WORDS, (to + 1) * KEY_RECORD_WORDS),
  }
}
