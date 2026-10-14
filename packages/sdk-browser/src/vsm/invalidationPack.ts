/**
 * A phase of the invalidation packed as its kernel reads it (`vsmStaleBoxes`): its items, and its
 * boxes, each range of boxes once, as instances of identity rotation (`VsmInvalidationInstance`).
 */
import type { VsmInstanceInvalidation } from './cacheManager.ts'
import {
  VSM_INVALIDATION_INSTANCE_BYTES,
  VSM_BOX_MOVING,
  VSM_BOX_CASTS,
} from './invalidationWgsl.ts'
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'
import { BOX_WORDS } from './invalidationPhase.ts'
import type { VsmInvalidationPhase } from './invalidationPass.ts'

// The scratch of `encodeVsmInvalidations`, rewritten for each phase: its items, its boxes as the
// shader reads them.
let items = new Uint32Array(64)
let image = new ArrayBuffer(VSM_INVALIDATION_INSTANCE_BYTES * 16)
let imageF = new Float32Array(image),
  imageU = new Uint32Array(image)
const INSTANCE_WORDS = VSM_INVALIDATION_INSTANCE_BYTES / 4
// The ranges of one phase, by their first instance: the index in the range lists of the last range
// taken at that offset (a range of the same offset and another count is a range of its own).
const rangeIndex = new Map<number, number>()
const rangeOffset: number[] = []
const rangeCount: number[] = []
const rangeAt: number[] = []

/** Packs the items of `list` (their first box in the image, box count, map, prefix), each range of
 *  boxes they name placed in the image once (`range*`): the threads they take, and the boxes. */
function packItems(list: readonly VsmInstanceInvalidation[]) {
  rangeIndex.clear()
  rangeOffset.length = rangeCount.length = rangeAt.length = 0
  let boxCount = 0,
    prefix = 0
  // A range's maps come one after another (one item per map): the last range is reused unkeyed.
  let lastOffset = -1,
    lastCount = -1,
    lastAt = 0
  if (items.length < list.length * 4) items = new Uint32Array(list.length * 8)
  for (let i = 0; i < list.length; i++) {
    const inv = list[i]
    let at = lastAt
    if (inv.firstInstance !== lastOffset || inv.instanceCount !== lastCount) {
      const found = rangeIndex.get(inv.firstInstance)
      if (found !== undefined && rangeCount[found] === inv.instanceCount) {
        at = rangeAt[found]
      } else {
        at = boxCount
        rangeIndex.set(inv.firstInstance, rangeOffset.length)
        rangeOffset.push(inv.firstInstance)
        rangeCount.push(inv.instanceCount)
        rangeAt.push(at)
        boxCount += inv.instanceCount
      }
      lastOffset = inv.firstInstance
      lastCount = inv.instanceCount
      lastAt = at
    }
    items[i * 4 + 0] = at
    items[i * 4 + 1] = inv.instanceCount
    items[i * 4 + 2] = inv.payload
    items[i * 4 + 3] = prefix
    prefix += inv.instanceCount
  }
  return { threads: prefix, boxCount }
}

/** Packs box `b` of `boxes` as instance `slot` of the image (96 B, `VsmInvalidationInstance`): an
 *  identity rotation whose translation is the box's centre (high f32, then low), a centre of 0, its
 *  extent and its flags; every other word 0. */
function packBox(boxes: Float64Array, b: number, slot: number) {
  const o = slot * INSTANCE_WORDS,
    at = b * BOX_WORDS
  imageF.fill(0, o, o + INSTANCE_WORDS)
  for (let c = 0; c < 3; c++) {
    // Column c = basis vector c; w = the translation's high f32.
    imageF[o + c * 5] = 1
    writeSplitDouble(imageF, o + c * 4 + 3, o + 12 + c, boxes[at + c])
    imageF[o + 20 + c] = boxes[at + 3 + c]
  }
  imageU[o + 19] = VSM_BOX_CASTS | (boxes[at + 6] ? VSM_BOX_MOVING : 0)
}

/** Packs the ranges `packItems` placed, `boxCount` boxes of `boxes`, into the image; the bytes they
 *  take. Every word of an instance is written: the image is not cleared. */
function packBoxes(boxes: Float64Array, boxCount: number) {
  const bytes = Math.max(1, boxCount) * VSM_INVALIDATION_INSTANCE_BYTES
  if (image.byteLength < bytes) {
    image = new ArrayBuffer(2 * bytes)
    imageF = new Float32Array(image)
    imageU = new Uint32Array(image)
  }
  for (let r = 0; r < rangeAt.length; r++)
    for (let j = 0; j < rangeCount[r]; j++) packBox(boxes, rangeOffset[r] + j, rangeAt[r] + j)
  return bytes
}

/** Packs `phase` into the scratch (`items`, the image): its item count, the threads it takes, the
 *  bytes of its boxes and the two word views to upload; none when it takes no thread. */
export function packPhase(phase: VsmInvalidationPhase) {
  const list = phase.batch.instances,
    { threads, boxCount } = packItems(list)
  if (threads === 0) return null
  const instanceBytes = packBoxes(phase.boxes, boxCount)
  return { itemCount: list.length, threads, instanceBytes, items, image: imageU }
}
