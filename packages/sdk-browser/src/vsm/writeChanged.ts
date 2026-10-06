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
import { coalesceRanges, RESIDENCY_RULE } from '../webgpu/residency/ranges.ts'

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

/** Writes into `buffer` the words of `image` in [`from`, `to`) (word indices, the same in both)
 *  that differ from those it holds. */
export function vsmWriteChanged(
  device: GPUDevice,
  buffer: GPUBuffer,
  image: Uint32Array<ArrayBuffer>,
  from: number,
  to: number,
) {
  let held = HELD.get(buffer)
  if (!held || held.length < to) {
    const grown = new Uint32Array(Math.min(buffer.size / 4, Math.max(to, 2 * (held?.length ?? 0))))
    if (held) grown.set(held)
    HELD.set(buffer, (held = grown))
  }
  let count = 0
  for (let k = from; k < to; k++)
    if (held[k] !== image[k]) {
      held[k] = image[k]
      if (count === changed.length) {
        const more = new Int32Array(2 * count)
        more.set(changed)
        changed = more
        rule.steps = new Int32Array(2 * count)
      }
      changed[count++] = k
    }
  const n = coalesceRanges(changed, count, ranges, rule)
  for (let r = 0; r < n; r++) {
    const first = ranges[2 * r]
    device.queue.writeBuffer(buffer, first * 4, image, first, ranges[2 * r + 1] - first + 1)
  }
}
