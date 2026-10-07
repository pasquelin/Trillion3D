/**
 * Uploads of the shadow maps that send only what changed. Each buffer written here is written by
 * this function alone: the words it holds are kept beside it, zero at first — WebGPU creates a
 * buffer zeroed, and a buffer made again starts its own copy —, and the words that differ go up in
 * the ranges the engine's one coalescer joins them into (`coalesceRanges`): words closer than the
 * residency flushes' gap share a write, sent with the value they hold, and past their cap the
 * narrowest steps are joined first — never the unused ids between the single-page and the full
 * maps' records of a table. The buffer then holds every word of the image it was given, the same
 * bytes a whole write would have left.
 */
import { coalesceRanges, RESIDENCY_RULE, type RangeRule } from '../webgpu/residency/ranges.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import type { UniformSlots } from '../residency/pools.ts'

const HELD = new WeakMap<GPUBuffer, Uint32Array>()
let changed = new Int32Array(64)
const rule = {
  gap: RESIDENCY_RULE.gap,
  cap: RESIDENCY_RULE.cap,
  overflow: 'narrowest' as const,
  steps: new Int32Array(64),
}
const ranges = new Int32Array(2 * rule.cap)

/** `target`, a copy of `source` whole (`copyBufferToBuffer`), holds the words `source` held: the
 *  next write to it sends what differs from them. */
export function vsmWriteChangedCopy(source: GPUBuffer, target: GPUBuffer) {
  const held = HELD.get(source)
  if (held) HELD.set(target, held.slice(0, target.size / 4))
}

/** The words `buffer` holds, at least its first `to`. */
function heldWords(buffer: GPUBuffer, to: number) {
  let held = HELD.get(buffer)
  if (!held || held.length < to) {
    const grown = new Uint32Array(clamp(2 * (held?.length ?? 0), to, buffer.size / 4))
    if (held) grown.set(held)
    HELD.set(buffer, (held = grown))
  }
  return held
}

/** Word `k` of `image` into `held` when they differ, listed `count`-th in `changed`; the count of
 *  the words listed. */
function follow(held: Uint32Array, image: Uint32Array, k: number, count: number) {
  if (held[k] === image[k]) return count
  held[k] = image[k]
  if (count === changed.length) {
    const more = new Int32Array(2 * count)
    more.set(changed)
    changed = more
    rule.steps = new Int32Array(2 * count)
  }
  changed[count] = k
  return count + 1
}

/** The `count` words `changed` lists, in increasing order, up to `buffer` in coalesced ranges —
 *  or in one range from the first to the last under `ONE_WRITE`. */
function send(
  device: GPUDevice,
  buffer: GPUBuffer,
  image: Uint32Array<ArrayBuffer>,
  count: number,
  join: RangeRule = rule,
) {
  const n = coalesceRanges(changed, count, ranges, join)
  for (let r = 0; r < n; r++) {
    const first = ranges[2 * r]
    device.queue.writeBuffer(buffer, first * 4, image, first, ranges[2 * r + 1] - first + 1)
  }
}

/** Writes into `buffer` the words of `image` in [`from`, `to`) (word indices, the same in both)
 *  that differ from those it holds. */
export function vsmWriteChanged(
  device: GPUDevice,
  buffer: GPUBuffer,
  image: Uint32Array<ArrayBuffer>,
  from: number,
  to: number,
) {
  const held = heldWords(buffer, to)
  let count = 0
  for (let k = from; k < to; k++) count = follow(held, image, k, count)
  send(device, buffer, image, count)
}

/** How the changed words of uniform slots go up: in the coalescer's ranges, or as `ONE_WRITE`. */
export type VsmSlotWrites = 'ranges' | 'one'

/** Every changed word in one write, from the first to the last: the words between hold their
 *  value, so the buffer is the same; for slots a whole write once sent, never more writes. */
const ONE_WRITE: RangeRule = { gap: Infinity, cap: 1, overflow: 'whole' }

/** As `vsmWriteChanged`, over slots [`first`, `end`) of `slots`, each its `words` words, in an
 *  image laid as the buffer (`strideWords` a slot): the padding up to the device's alignment, never
 *  written, is never compared. In `'ranges'`, two slots share a write only where the coalescer
 *  joins the gap between them (`coalesceRanges`) — at 256 bytes, the writes of a whole compare —;
 *  in `'one'`, what changed goes up in a single write, as the whole slots once did. */
export function vsmWriteChangedSlots(
  device: GPUDevice,
  buffer: GPUBuffer,
  image: Uint32Array<ArrayBuffer>,
  slots: Pick<UniformSlots, 'count' | 'words' | 'strideWords'>,
  first = 0,
  end = slots.count,
  writes: VsmSlotWrites = 'ranges',
) {
  if (end <= first) return
  const { words, strideWords } = slots
  const held = heldWords(buffer, (end - 1) * strideWords + words)
  let changes = 0
  for (let s = first; s < end; s++)
    for (let k = s * strideWords, last = k + words; k < last; k++)
      changes = follow(held, image, k, changes)
  send(device, buffer, image, changes, writes === 'one' ? ONE_WRITE : rule)
}

/** As `vsmWriteChanged`, over the records `records` lists alone — `count` record indices,
 *  increasing and distinct, `width` words each at `index · width`: an image whose other words
 *  never change, sparse in a wide table, is compared where it can differ and nowhere else. */
export function vsmWriteChangedRecords(
  device: GPUDevice,
  buffer: GPUBuffer,
  image: Uint32Array<ArrayBuffer>,
  records: ArrayLike<number>,
  count: number,
  width: number,
) {
  if (!count) return
  const held = heldWords(buffer, (records[count - 1] + 1) * width)
  let changes = 0
  for (let j = 0; j < count; j++)
    for (let k = records[j] * width, end = k + width; k < end; k++)
      changes = follow(held, image, k, changes)
  send(device, buffer, image, changes)
}
