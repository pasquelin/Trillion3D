/**
 * Compact cut layout, written once by packing and reread by two readers: the shader
 * (`shader/shader.ts`, `shader/recordWgsl.ts`) and the oracle (`records.fixture.ts`). Both
 * go through this module alone, so no field rank is written twice — that is what
 * guarantees the oracle returns the same verdict as the GPU, to the bit.
 *
 * Two records per UNIQUE cluster, split by what the frame rereads:
 *
 * - hot (`CLUSTER_WORDS` words, the `clusters` record table) only holds what all five passes of
 *   a frame read: the cluster sphere and its parent's, both errors and the flags — level
 *   included, in their high bits;
 * - cold (`COLD_WORDS` words, the cold words' record table) holds what the cluster tests alone
 *   read: the box, the triangles, and the cut node that owns the page, relative to its
 *   placement's first node, which only the oracle uses to replay descent.
 *
 * A record depends on no placement: the twelve placements of one primitive share one. What
 * is proper to a placement lives in the WORKING TABLE at the head of `coldWords`, one word
 * per page — the page's placement —, and the placement's record shift travels in its frame
 * words (`worlds/worlds.ts`): the page's record is its index plus that shift.
 *
 * Residency follows the working table as bits, one word for thirty-two pages: passes that
 * read it do not walk a forty-eight-byte record for a single flag, and the host only
 * rewrites the words its changes touch. The cold records come last.
 */
import { CLUSTER_LEVEL_SHIFT, CLUSTER_NEVER, CLUSTER_TRANSPARENT } from './clusterFlags.ts'
import { copiedWords } from './readoutWords.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { bitWords } from '../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { lastTrue } from '../../../../math/src/scalar/search.ts'

/** The hot record, `struct Cluster` of the shader: its fields' ranks and its declaration. */
export const CLUSTER_LAYOUT = fieldLayout('Cluster', [
  ['sphere', 'vec4f'],
  ['parentSphere', 'vec4f'],
  ['lodError', 'f32'],
  ['parentError', 'f32'],
  ['flags', 'u32'],
])
/** Words of the hot record: eleven, and WGSL rounds its stride to sixteen bytes — the twelfth
 *  word is that padding. */
export const CLUSTER_WORDS = CLUSTER_LAYOUT.words
/** Words of the cold record. */
export const COLD_WORDS = 9
const CLUSTER_LEVEL_MAX = 0xffffff

export function packClusterFlags(never: boolean, level: number, transparent = false) {
  const bounded = clamp(Math.trunc(level) || 0, 0, CLUSTER_LEVEL_MAX)
  return (
    ((never ? CLUSTER_NEVER : 0) |
      (transparent ? CLUSTER_TRANSPARENT : 0) |
      (bounded << CLUSTER_LEVEL_SHIFT)) >>>
    0
  )
}

/**
 * Readout CAP, in ranks, for each of its two halves.
 *
 * A readout buffer sized on `pageCount` — the worst case, a cut that would keep
 * the whole catalogue — makes the frame copy take all of it: 15.2 MiB per frame at
 * 1,992,187 clusters, for a cut that keeps about a hundredth. Measured on a Metal 3 device
 * (`tests/gpu/dag/cut-snapshot.gpu.ts`): 1.17 ms per frame for the full readout vs
 * 0.52 ms for a capped readout, when the kernels themselves cost 0.99.
 *
 * The cap is WIDE next to a real cut: the same bench keeps 7,812 ranks of 1,992,187 at
 * threshold 64, 31,250 at threshold 16. It holds for the cut's life: overflow remains possible — a
 * camera placed in the geometry at a tiny threshold, hundreds of thousands of placements — and
 * it is SAID: the kernel sets the overflow bit, the frame still draws by its mask, and the host
 * adopts the head of each list, never an exit from it (`../cut/adoption/adoption.ts`). The GPU's
 * own lists, which the frame draws from, hold their settings' caps (`lists/cutListCaps.ts`).
 */
export const SELECTION_LIST_CAP = 262144
/** Cap of a scene: never more than its catalogue, which no cut can exceed. */
export const selectionListCap = (pageCount: number) => clamp(pageCount, 0, SELECTION_LIST_CAP)
/** Bytes a resident cut's frame copies: every list up to the requests' priorities. */
export const residentReadbackBytes = (listCap: number) => copiedWords(listCap) * 4
/** Word of `out` where the snapshot the next difference is taken against waits, behind the
 *  requests' priorities and outside what the frame copies (`keptAt` of
 *  `shader/differenceWgsl.ts`): its two lengths (`KEPT_HEADER_WORDS`), then the requests' pages and
 *  the drawn pages, a list each. */
export const keptSnapshotWord = (listCap: number) => copiedWords(listCap)
/** Words ahead of the kept lists: the length of each of the two. */
export const KEPT_HEADER_WORDS = 2
/** Word of `out` where region `v`'s saved drawn journal lies, behind the kept snapshot: its
 *  length, then `listCap` pages (`shader/swapWgsl.ts`); region 0 the main view's, one more a view
 *  drawn aside (`swap/swap.ts`). Region `regions` is the word behind all of them, where the open counts
 *  placements hold of their own lie (`heldOpen.ts`): written by the host alone, outside what the
 *  frame copies. */
export const savedJournalWord = (listCap: number, v: number) =>
  keptSnapshotWord(listCap) + KEPT_HEADER_WORDS + 2 * listCap + v * (1 + listCap)
/** Bytes of `out` with the kept snapshot and `regions` saved journals behind what the frame
 *  copies — none until a view is drawn aside: what the kernels write, more than the frame
 *  copies. */
export const stagedOutputBytes = (listCap: number, regions = 0) =>
  savedJournalWord(listCap, regions) * 4
/** The most ranks an `out` of `bytes` holds: `stagedOutputBytes` read backwards. It grows with
 *  every rank, so the largest cap that fits is found by halving, without a closed form to keep in
 *  step with each region the readout gains. */
export function listCapHeld(bytes: number) {
  // A rank is a word: past 2^32 ranks no list is named, and the halving stays exact.
  return lastTrue(
    0,
    clamp(Math.floor(bytes / 4), 0, 2 ** 32),
    (mid) => stagedOutputBytes(mid) <= bytes,
  )
}
/** Readback slots the cut alternates between (`dispatch.ts`): the cache reads a drawn list at
 *  most this many frames behind the GPU, plus the frame being encoded. */
export const DAG_READBACK_SLOTS = 2
export const OUT_COUNT = 0,
  OUT_FRUSTUM_REJECTED = 1,
  OUT_LOD_LEVEL = 2,
  OUT_FLAGS = 3,
  OUT_SELECTED_TRIANGLES = 4,
  OUT_TRANSPARENT_TRIANGLES = 5,
  /** The items the previous image's pyramid hid, held for the post pass, and those the post pass's
   *  pyramid hid for good (`shader/occlusionWgsl.ts`). */
  OUT_OCCLUDED = 6,
  OUT_POST_HIDDEN = 7

/** Residency words: one bit per cluster, thirty-two clusters per word. The first set opens the
 *  cold words at word 0: the cut rule's `resident(c)` (`../cut/readiness.ts`, `ready`). A
 *  page names its placement in the entries that carry it (`shader/levelWgsl.ts`), never in a word
 *  of its own. */
export const residentWords = (pageCount: number) => bitWords(Math.max(0, pageCount))
/** First word of the second bit set, the rule's `resident(childGroup(c))` (`childReady`). */
export const childBase = (pageCount: number) => residentWords(pageCount)
/** First cold record, behind the two bit sets. */
export const coldBase = (pageCount: number) => childBase(pageCount) + residentWords(pageCount)

/** Hot field ranks, as `struct Cluster` of the shader lays them out. */
export const {
  sphere: HOT_SPHERE,
  parentSphere: HOT_PARENT_SPHERE,
  lodError: HOT_LOD_ERROR,
  parentError: HOT_PARENT_ERROR,
  flags: HOT_FLAGS,
} = CLUSTER_LAYOUT.at
/** Cold field ranks, in the order `shader/recordWgsl.ts` reads them by word. */
export const COLD_MIN = 0,
  COLD_HAS_BOX = 3,
  COLD_MAX = 4,
  /** Owner node, relative to the placement's first node: the same for every placement. */
  COLD_OWNER = 7,
  /** Cluster triangles, read as an INTEGER word: those are what the totals accumulate. */
  COLD_TRIANGLES = 8
