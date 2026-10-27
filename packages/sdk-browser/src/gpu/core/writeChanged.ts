/**
 * Uploads that send only what changed. Each buffer written here is written by
 * this function alone: the words it holds are kept beside it, zero at first — WebGPU creates a
 * buffer zeroed, and a buffer made again starts its own copy —, and the words that differ go up in
 * the ranges the engine's one coalescer joins them into (`coalesceRanges`): words closer than the
 * residency flushes' gap share a write, sent with the value they hold, and past their cap the
 * narrowest steps are joined first — never the unused ids between the single-page and the full
 * maps' records of a table. The buffer then holds every word of the image it was given, the same
 * bytes a whole write would have left.
 */
import {
  WRITE_CAP,
  coalesceRanges,
  writeRule,
  type RangeRule,
} from '../../geometry/residency/ranges.ts'
import { grownLength, resized } from '../../../../math/src/sequence/resized.ts'
import type { UniformSlots } from '../../session/memory/pools.ts'

const HELD = new WeakMap<GPUBuffer, Uint32Array>(),
  NONE = new Uint32Array(0)
/** The buffers a GPU kernel wrote into behind the upload's back, each with the count of its first words
 *  the kernel may have written: what the words held beside them say is no longer what they hold. */
const WRITTEN_ON_GPU = new WeakMap<GPUBuffer, number>()

/** A kernel wrote into the first `words` words of `buffer`: the next `writeChanged` of it sends them
 *  whole, whatever the words held say, and the mark is gone. Only `writeChanged` takes such a buffer. */
export function markWrittenOnGpu(buffer: GPUBuffer, words: number) {
  WRITTEN_ON_GPU.set(buffer, Math.max(words, WRITTEN_ON_GPU.get(buffer) ?? 0))
}

/** The writers by slots and by records compare against the words held: a buffer a kernel wrote into
 *  is theirs no longer. */
function refuseMarked(buffer: GPUBuffer) {
  if (WRITTEN_ON_GPU.has(buffer))
    throw new Error(`writeChanged: '${buffer.label}' was written on the GPU: write it whole`)
}
let changed = new Int32Array(64)
const rule: RangeRule = { gap: 0, cap: WRITE_CAP, steps: new Int32Array(64) }
const ranges = new Int32Array(2 * WRITE_CAP)

/** `target`, a copy of `source` whole (`copyBufferToBuffer`), holds the words `source` held: the
 *  next write to it sends what differs from them, or, if a kernel wrote into `source`
 *  (`markWrittenOnGpu`), the words it wrote whole. */
export function writeChangedCopy(source: GPUBuffer, target: GPUBuffer) {
  const held = HELD.get(source)
  if (held) HELD.set(target, held.slice(0, target.size / 4))
  const written = WRITTEN_ON_GPU.get(source)
  if (written !== undefined) WRITTEN_ON_GPU.set(target, written)
}

/** The words `buffer` holds, at least its first `to`, grown by `grownLength` up to its size. */
function heldWords(buffer: GPUBuffer, to: number) {
  const held = HELD.get(buffer) ?? NONE
  if (held.length >= to) return held
  const grown = new Uint32Array(Math.min(grownLength(held.length, to), buffer.size / 4))
  grown.set(held)
  HELD.set(buffer, grown)
  return grown
}

/** Word `k` of `image` into `held` when they differ, listed `count`-th in `changed`; the count of
 *  the words listed. */
function follow(held: Uint32Array, image: Uint32Array, k: number, count: number) {
  if (held[k] === image[k]) return count
  held[k] = image[k]
  if (count === changed.length) {
    changed = resized(changed, count + 1)
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
  join?: RangeRule,
) {
  const n = coalesceRanges(changed, count, ranges, join ?? writeRule(rule, 1, count))
  for (let r = 0; r < n; r++) {
    const first = ranges[2 * r]
    device.queue.writeBuffer(buffer, first * 4, image, first, ranges[2 * r + 1] - first + 1)
  }
}

/** Writes into `buffer` the words of `image` in [`from`, `to`) (word indices, the same in both)
 *  that differ from those it holds. A buffer a kernel wrote into (`markWrittenOnGpu`) holds none of
 *  what it says: the image goes up whole once, from its first word to the last the kernel may have
 *  written or `to`, and the words held become the image's. */
export function writeChanged(
  device: GPUDevice,
  buffer: GPUBuffer,
  image: Uint32Array<ArrayBuffer>,
  from: number,
  to: number,
) {
  const written = WRITTEN_ON_GPU.get(buffer)
  if (written !== undefined) {
    WRITTEN_ON_GPU.delete(buffer)
    const end = Math.max(to, written)
    heldWords(buffer, end).set(image.subarray(0, end))
    device.queue.writeBuffer(buffer, 0, image, 0, end)
    return
  }
  const held = heldWords(buffer, to)
  let count = 0
  for (let k = from; k < to; k++) count = follow(held, image, k, count)
  send(device, buffer, image, count)
}

/** How the changed words of uniform slots go up: in the coalescer's ranges, or as `ONE_WRITE`. */
type SlotWrites = 'ranges' | 'one'

/** Every changed word in one write, from the first to the last: the words between hold their
 *  value, so the buffer is the same; for slots a whole write once sent, never more writes. */
const ONE_WRITE: RangeRule = { gap: Infinity, cap: 1, steps: new Int32Array(0) }

/** As `writeChanged`, over slots [`first`, `end`) of `slots`, each its `words` words, in an
 *  image laid as the buffer (`strideWords` a slot): the padding up to the device's alignment, never
 *  written, is never compared. In `'ranges'`, two slots share a write only where the coalescer
 *  joins the gap between them (`coalesceRanges`) — at 256 bytes, the writes of a whole compare —;
 *  in `'one'`, what changed goes up in a single write, as the whole slots once did. */
export function writeChangedSlots(
  device: GPUDevice,
  buffer: GPUBuffer,
  image: Uint32Array<ArrayBuffer>,
  slots: Pick<UniformSlots, 'count' | 'words' | 'strideWords'>,
  first = 0,
  end = slots.count,
  writes: SlotWrites = 'ranges',
) {
  if (end <= first) return
  refuseMarked(buffer)
  const { words, strideWords } = slots
  const held = heldWords(buffer, (end - 1) * strideWords + words)
  let changes = 0
  for (let s = first; s < end; s++)
    for (let k = s * strideWords, last = k + words; k < last; k++)
      changes = follow(held, image, k, changes)
  send(device, buffer, image, changes, writes === 'one' ? ONE_WRITE : undefined)
}

/** As `writeChanged`, over the records `records` lists alone — `count` record indices,
 *  increasing and distinct, `width` words each at `index · width`: an image whose other words
 *  never change, sparse in a wide table, is compared where it can differ and nowhere else. */
export function writeChangedRecords(
  device: GPUDevice,
  buffer: GPUBuffer,
  image: Uint32Array<ArrayBuffer>,
  records: ArrayLike<number>,
  count: number,
  width: number,
) {
  if (!count) return
  refuseMarked(buffer)
  const held = heldWords(buffer, (records[count - 1] + 1) * width)
  let changes = 0
  for (let j = 0; j < count; j++)
    for (let k = records[j] * width, end = k + width; k < end; k++)
      changes = follow(held, image, k, changes)
  send(device, buffer, image, changes)
}
