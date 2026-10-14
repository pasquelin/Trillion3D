import { coalesceRanges, type RangeRule } from '../../webgpu/residency/ranges.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'

/** Where `writeRanges` sends a run: `size` bytes of `data` from `dataOffset`, at byte `offset` of
 *  the table the target lays out — a record table's field (`../core/recordTexture.ts`, `target`),
 *  or a buffer. */
export type RangeTarget = (
  offset: number,
  data: ArrayBuffer,
  dataOffset: number,
  size: number,
) => void

/** What `writeRanges` sends: the source's words, `stride` per index, from word `sourceBase` there
 *  and from word `targetBase` in the table. */
export type RangeSource = {
  data: Float32Array | Uint32Array
  sourceBase: number
  targetBase: number
  stride: number
}

/** Bytes a run may leave unchanged between two written records and still be one write. */
const GAP_BYTES = 256
/** Writes an upload makes at most; past it, the narrowest gaps join. */
const CAP = 1024

/** The runs a write joins its indices into (`joinedRanges`): one scratch for every upload, `CAP`
 *  runs at most, `[first, last]` pairs the next join overwrites. */
export const joinedSpans = new Int32Array(CAP * 2)
/** The one rule every upload joins by, its gap set to the record's bytes. */
const rule: RangeRule & { overflow: 'narrowest' } = {
  gap: 0,
  cap: CAP,
  overflow: 'narrowest',
  steps: new Int32Array(64),
}

/**
 * How the indices of records of `stride` words join into writes, by their bytes whatever the
 * record — a link, an exact translation, a world, a tree node, a card —: a run spans at most
 * `GAP_BYTES` unchanged, up to `CAP` writes, the narrowest gaps joined past it. Scattered moves
 * never rewrite everything between the lowest and the highest.
 */
function ruleFor(stride: number, count: number): RangeRule {
  rule.steps = resized(rule.steps, count)
  rule.gap = 1 + Math.floor(GAP_BYTES / (stride * 4))
  return rule
}

/**
 * The `count` increasing indices of `sorted`, records of `stride` words, joined into ranges by the
 * engine's one rule (`ruleFor`, `coalesceRanges`): `[first, last]` pairs in `joinedSpans`, which
 * the next join overwrites; their count — nothing allocated. What `writeRanges` sends, and what a
 * writer that packs its records itself sends a run at a time (`../../placement/rootWorlds.ts`).
 */
export const joinedRanges = (sorted: Int32Array, count: number, stride: number) =>
  coalesceRanges(sorted, count, joinedSpans, ruleFor(stride, count))

/**
 * The one run writer of the engine's tables: the `count` increasing indices of `sorted` joined into
 * ranges (`joinedRanges`), each sent as one write through `target` — the residency bits, the
 * placements' links, the cut's records, the worlds a call named and their exact translations, the
 * frame words, the placement tree's nodes and lists (`treeTable.ts`), the impostor cards.
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
