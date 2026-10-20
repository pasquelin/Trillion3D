import { WRITE_CAP, coalesceRanges, writeRule, type RangeRule } from '../residency/ranges.ts'

/** Where `writeRanges` sends a run: `size` bytes of `data` from `dataOffset`, at byte `offset` of
 *  the table the target lays out — a record table's field (`../../gpu/core/recordTexture.ts`, `target`),
 *  or a buffer. */
export type RangeTarget = (
  offset: number,
  data: ArrayBuffer,
  dataOffset: number,
  size: number,
) => void

/** `buffer` as a run target: each run written `baseBytes` past its offset. */
export const bufferRangeTarget =
  (device: GPUDevice, buffer: GPUBuffer, baseBytes = 0): RangeTarget =>
  (offset, data, dataOffset, size) =>
    device.queue.writeBuffer(buffer, baseBytes + offset, data, dataOffset, size)

/** What `writeRanges` sends: the source's words, `stride` per index, from word `sourceBase` there
 *  and from word `targetBase` in the table. */
export type RangeSource = {
  data: Float32Array | Uint32Array
  sourceBase: number
  targetBase: number
  stride: number
}

/** The runs a write joins its indices into (`joinedRanges`): one scratch for every upload,
 *  `WRITE_CAP` runs at most, `[first, last]` pairs the next join overwrites. */
export const joinedSpans = new Int32Array(WRITE_CAP * 2)
const rule: RangeRule = { gap: 0, cap: WRITE_CAP, steps: new Int32Array(64) }

/**
 * The `count` increasing indices of `sorted`, records of `stride` words, joined into ranges by the
 * engine's one write rule (`writeRule`, `coalesceRanges`): `[first, last]` pairs in `joinedSpans`, which
 * the next join overwrites; their count — nothing allocated. What `writeRanges` sends, and what a
 * writer that packs its records itself sends a run at a time (`../../placement/roots/rootWorlds.ts`).
 */
export const joinedRanges = (sorted: Int32Array, count: number, stride: number) =>
  coalesceRanges(sorted, count, joinedSpans, writeRule(rule, stride, count))

/**
 * The one run writer of the engine's tables: the `count` increasing indices of `sorted` joined into
 * ranges (`joinedRanges`), each sent as one write through `target` — the residency bits, the
 * placements' links, the cut's records, the worlds a call named and their exact translations, the
 * frame words, the placement tree's nodes and lists (`tree/treeTable.ts`).
 */
export function writeRanges(
  target: RangeTarget,
  sorted: Int32Array,
  count: number,
  { data, sourceBase, targetBase, stride }: RangeSource,
) {
  const runs = joinedRanges(sorted, count, stride)
  for (let r = 0; r < runs; r++) {
    const first = joinedSpans[r * 2],
      bytes = (joinedSpans[r * 2 + 1] - first + 1) * stride * 4,
      offset = (targetBase + first * stride) * 4,
      from = data.byteOffset + (sourceBase + first * stride) * 4
    target(offset, data.buffer as ArrayBuffer, from, bytes)
  }
}

/** The `count` increasing indices of `sorted`, records of `stride` words of `words`, sent into
 *  `buffer` at the same places in `writeRanges`'s runs. */
export function writeBufferRuns(
  device: GPUDevice,
  buffer: GPUBuffer,
  sorted: Int32Array,
  count: number,
  words: Uint32Array,
  stride: number,
) {
  writeRanges(bufferRangeTarget(device, buffer), sorted, count, {
    data: words,
    sourceBase: 0,
    targetBase: 0,
    stride,
  })
}
