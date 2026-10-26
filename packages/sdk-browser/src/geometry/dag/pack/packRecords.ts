import type { DagRoot } from '../types.ts'
import { parentErrorOf } from '../../selection/helpers.ts'
import {
  CLUSTER_WORDS,
  COLD_HAS_BOX,
  COLD_MAX,
  COLD_MIN,
  COLD_OWNER,
  COLD_TRIANGLES,
  COLD_WORDS,
  HOT_FLAGS,
  HOT_LOD_ERROR,
  HOT_PARENT_ERROR,
  HOT_PARENT_SPHERE,
  HOT_SPHERE,
  packClusterFlags,
} from '../layout.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'
import { NO_INDEX } from '../../../../../math/src/constants.ts'

function writeSphere(
  target: Float32Array,
  at: number,
  sphere: ArrayLike<number> | null | undefined,
) {
  const ok = !!sphere && sphere.length >= 4
  target[at] = ok ? sphere![0] : 0
  target[at + 1] = ok ? sphere![1] : 0
  target[at + 2] = ok ? sphere![2] : 0
  target[at + 3] = ok ? sphere![3] : 0
}

/** A placement's hot and cold records, written from rank 0 of `hot` and `cold`. `owner` holds the
 *  absolute owner node; the record keeps it relative to `nodeBase`, the placement's first node. */
function writeRecords(
  pages: DagRoot['pages'],
  owner: Uint32Array,
  nodeBase: number,
  hot: Float32Array,
  cold: Float32Array,
) {
  const hotInts = new Uint32Array(hot.buffer),
    coldInts = new Uint32Array(cold.buffer)
  for (let i = 0; i < pages.length; i++) {
    const rec = pages[i],
      dst = i * CLUSTER_WORDS
    writeSphere(hot, dst + HOT_SPHERE, rec.sphere)
    writeSphere(hot, dst + HOT_PARENT_SPHERE, rec.parentSphere ?? rec.sphere)
    const parent = parentErrorOf(rec) ?? -1
    hot[dst + HOT_LOD_ERROR] = rec.lodError ?? 0
    hot[dst + HOT_PARENT_ERROR] = parent
    // A cluster that no culling leaf owns is unreachable for the CPU cut too; never select it.
    hotInts[dst + HOT_FLAGS] = packClusterFlags(
      owner[i] === NO_INDEX,
      rec.level ?? 0,
      !!rec.transparent,
    )
    const base = i * COLD_WORDS,
      hasBox = rec.min && rec.max ? 1 : 0
    cold[base + COLD_HAS_BOX] = hasBox
    for (let a = 0; a < 3; a++) {
      cold[base + COLD_MIN + a] = hasBox ? rec.min![a] : 0
      cold[base + COLD_MAX + a] = hasBox ? rec.max![a] : 0
    }
    // The owner node is only read by the oracle, which replays descent: it stays cold.
    coldInts[base + COLD_OWNER] = owner[i] === NO_INDEX ? NO_INDEX : owner[i] - nodeBase
    // Cluster triangles, as an integer word: the GPU holds the totals.
    coldInts[base + COLD_TRIANGLES] = Math.max(0, Math.trunc(rec.triangles ?? 0))
  }
}

type Block = { hot: Uint32Array; cold: Uint32Array; base: number }

/** The scratch the words of a placement's pages are written in: grown to the largest placement. */
type Scratch = { hot: Float32Array; cold: Float32Array }

/** The words `pages` write, in `scratch`. */
function writtenIn(
  scratch: Scratch,
  pages: DagRoot['pages'],
  owner: Uint32Array,
  nodeBase: number,
) {
  const n = pages.length
  if (scratch.hot.length < n * CLUSTER_WORDS) {
    scratch.hot = new Float32Array(n * CLUSTER_WORDS)
    scratch.cold = new Float32Array(n * COLD_WORDS)
  }
  const { hot, cold } = scratch
  writeRecords(pages, owner, nodeBase, hot, cold)
  return {
    hotBits: new Uint32Array(hot.buffer, 0, n * CLUSTER_WORDS),
    coldBits: new Uint32Array(cold.buffer, 0, n * COLD_WORDS),
  }
}

/** The first record of an earlier block of `shape` holding these words exactly, or -1. */
function matchBlock(
  byShape: Map<object, Block[]>,
  shape: object,
  { hotBits, coldBits }: ReturnType<typeof writtenIn>,
) {
  for (const block of byShape.get(shape) ?? [])
    if (sameValues(block.hot, hotBits) && sameValues(block.cold, coldBits)) return block.base
  return -1
}

/**
 * The unique records of a packing. Each placement writes its records into a scratch, then takes
 * those of an earlier placement of the same culling shape when they match TO THE BIT, or keeps
 * its own. The match is on the written words, not on the shape alone: a placement whose pages
 * differ in any field keeps its own records, and the cut reads exactly what it read unshared.
 */
export function createRecordTable() {
  const blocks: Block[] = [],
    byShape = new Map<object, Block[]>()
  const scratch: Scratch = { hot: new Float32Array(0), cold: new Float32Array(0) }
  let count = 0
  const written = (pages: DagRoot['pages'], owner: Uint32Array, nodeBase: number) =>
    writtenIn(scratch, pages, owner, nodeBase)
  const match = (shape: object, words: ReturnType<typeof written>) =>
    matchBlock(byShape, shape, words)
  return {
    get count() {
      return count
    },
    /** The first record of an earlier placement whose written words are these pages' exactly, or
     *  -1: nothing is added. */
    find: (pages: DagRoot['pages'], shape: object, owner: Uint32Array, nodeBase: number) =>
      match(shape, written(pages, owner, nodeBase)),
    /** First record of this placement's pages, shared or new. */
    place(pages: DagRoot['pages'], shape: object, owner: Uint32Array, nodeBase: number) {
      const n = pages.length
      const words = written(pages, owner, nodeBase),
        found = match(shape, words)
      if (found >= 0) return found
      const { hotBits, coldBits } = words,
        known = byShape.get(shape)
      const block = { hot: hotBits.slice(), cold: coldBits.slice(), base: count }
      count += n
      blocks.push(block)
      if (known) known.push(block)
      else byShape.set(shape, [block])
      return block.base
    },
    /** The unique blocks held: the first a later `finish` copies from. */
    get blocks() {
      return blocks.length
    },
    /** Copies every unique record into the final buffers, the cold ones from word `coldAt` — or,
     *  from block `first` on, those a growth added. */
    finish(clusters: Float32Array, coldWords: Float32Array, coldAt: number, first = 0) {
      const hotInts = new Uint32Array(clusters.buffer, clusters.byteOffset),
        coldInts = new Uint32Array(coldWords.buffer, coldWords.byteOffset)
      for (const block of blocks.slice(first)) {
        hotInts.set(block.hot, block.base * CLUSTER_WORDS)
        coldInts.set(block.cold, coldAt + block.base * COLD_WORDS)
      }
    },
  }
}
