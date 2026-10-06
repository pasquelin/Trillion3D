import { KEY_HAS_BOX, KEY_RECORD_WORDS } from './orderWgsl.ts'
import type { createWebgpuBlendState } from './state.ts'
type BlendState = ReturnType<typeof createWebgpuBlendState>

const RECORD_DOUBLES = KEY_RECORD_WORDS / 2

/**
 * WHAT THE ORDER KERNEL KEYS AN ITEM FROM (`itemKey`, `orderWgsl.ts`): the six doubles of its
 * world box, or the three of its world origin when it has none, then its flags and its own rank —
 * the rank of its CPU key in the frame data when it draws its own slot (`runs.ts`), `NOT_OWN`
 * otherwise. The doubles are copied bit for bit: the kernel computes on the CPU's numbers.
 *
 * Rewritten with the plan (`refreshBlendScene`), which follows every box a matrix move rebuilt; an
 * own item's box may move every frame (a deformed copy), and the kernel never reads it: its key
 * comes from the CPU.
 */
export function writeKeyRecords(blendState: BlendState) {
  const items = blendState.blendGpu,
    doubles = items.length * RECORD_DOUBLES
  if (blendState.keyPacked.length < doubles) {
    blendState.keyPacked = new Float64Array(doubles)
    blendState.keyWords = new Uint32Array(blendState.keyPacked.buffer)
  }
  const packed = blendState.keyPacked,
    words = blendState.keyWords,
    own = blendState.ownRanks
  for (let i = 0; i < items.length; i++) {
    const item = items[i],
      at = i * RECORD_DOUBLES,
      box = item.bounds
    if (box) packed.set(box, at)
    else {
      const m = item.matrix.elements
      packed[at] = m[12]
      packed[at + 1] = m[13]
      packed[at + 2] = m[14]
    }
    words[i * KEY_RECORD_WORDS + 12] = box ? KEY_HAS_BOX : 0
    words[i * KEY_RECORD_WORDS + 13] = own[i]
  }
  return words.subarray(0, items.length * KEY_RECORD_WORDS)
}
