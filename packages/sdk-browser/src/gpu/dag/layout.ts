/**
 * Compact cut layout, written once by packing and reread by two readers: the shader
 * (`shader/shader.ts`, `shader/recordWgsl.ts`) and the oracle (`records.fixture.ts`). Both
 * go through this module alone, so no field rank is written twice — that is what
 * guarantees the oracle returns the same verdict as the GPU, to the bit.
 *
 * Two records per UNIQUE cluster, split by what the frame rereads:
 *
 * - hot (`CLUSTER_WORDS` words, `clusters` buffer) only holds what all five passes of
 *   a frame read: the cluster sphere and its parent's, both errors and the flags — level
 *   included, in their high bits;
 * - cold (`COLD_WORDS` words, `pageCones` buffer) holds what the open pass alone reads:
 *   the normal cone, the box, and the cut node that owns the page, relative to its
 *   placement's first node, which only the oracle uses to replay descent.
 *
 * A record depends on no placement: the twelve placements of one primitive share one. What
 * is proper to a placement lives in the WORKING TABLE at the head of `pageCones`, one word
 * per page — the page's placement —, and the placement's record shift travels in its frame
 * words (`worlds.ts`): the page's record is its index plus that shift.
 *
 * Residency follows the working table as bits, one word for thirty-two pages: passes that
 * read it no longer walk a forty-eight-byte record for a single flag, and the host only
 * rewrites the words its changes touch. The cold records come last.
 */
import { CLUSTER_LEVEL_SHIFT, CLUSTER_NEVER, CLUSTER_TRANSPARENT } from './clusterFlags.ts';
import { stagedRequestsWord } from './readoutWords.ts';
export {
  SELECTION_HEADER_WORDS,
  evictionWord,
  EVICTION_BURST,
  differenceWord,
} from './readoutWords.ts';

/** Words of the hot record: `struct Cluster` of the shader holds eleven, and WGSL rounds its
 *  stride to sixteen bytes — the twelfth word is that padding. */
export const CLUSTER_WORDS = 12;
/** Words of the cold record; `PAGE_CONE_FLOATS` in `../core/selection.ts` is the public mirror. */
export const COLD_WORDS = 13;
const CLUSTER_LEVEL_MAX = 0xffffff;

export function packClusterFlags(never: boolean, level: number, transparent = false) {
  const bounded = Math.min(Math.max(Math.trunc(level) || 0, 0), CLUSTER_LEVEL_MAX);
  return (
    ((never ? CLUSTER_NEVER : 0) |
      (transparent ? CLUSTER_TRANSPARENT : 0) |
      (bounded << CLUSTER_LEVEL_SHIFT)) >>>
    0
  );
}

/**
 * Readout CAP, in ranks, for each of its two halves.
 *
 * The readout buffer was sized on `pageCount` — the worst case, a cut that would keep
 * the whole catalogue — and the frame copy took all of it: 15.2 MiB per frame at
 * 1,992,187 clusters, for a cut that keeps about a hundredth. Measured on apple metal-3
 * (`tests/gpu/dag/cut-snapshot.gpu.ts`): 1.17 ms per frame for the full readout vs
 * 0.52 ms for a capped readout, when the kernels themselves cost 0.99.
 *
 * The cap is WIDE next to a real cut: the same bench keeps 7,812 ranks of 1,992,187 at
 * threshold 64, 31,250 at threshold 16. It is where a cut STARTS: overflow remains possible — a
 * camera placed in the geometry at a tiny threshold, hundreds of thousands of placements — and
 * it is SAID: the kernel sets the overflow bit, and the cut grows its list within the device
 * (`listCap.ts`). Only a list the device cannot hold stays truncated, and the frame falls back
 * to the CPU cut, which knows how to pick a representable subset. A truncated readout is never
 * adopted as if it were whole. The pool's list (`poolBase`) keeps this cap.
 */
export const SELECTION_LIST_CAP = 262144;
/** Cap of a scene: never more than its catalogue, which no cut can exceed. */
export const selectionListCap = (pageCount: number) =>
  Math.min(Math.max(0, pageCount), SELECTION_LIST_CAP);
/** Bytes a resident cut's frame copies: everything before the staged requests. */
export const residentReadbackBytes = (listCap: number) => stagedRequestsWord(listCap) * 4;
/** Requests ahead of the camera one sample stages: half its cap. They wait behind the camera's own
 *  staged requests, on their own counter (header word 6, before `OUT_AHEAD_PLACED`), so they never
 *  take a place the camera's requests would have used (`shader/snapshotWgsl.ts`). */
const aheadRequestCap = (listCap: number) => listCap >>> 1;
/** Word of `out` where the snapshot the next difference is taken against waits, behind the staged
 *  requests and outside what the frame copies (`keptAt` of `shader/differenceWgsl.ts`): its two
 *  lengths (`KEPT_HEADER_WORDS`), then the requests' pages and the drawn pages, a list each. */
export const keptSnapshotWord = (listCap: number) =>
  stagedRequestsWord(listCap) + listCap + aheadRequestCap(listCap);
/** Words ahead of the kept lists: the length of each of the two. */
export const KEPT_HEADER_WORDS = 2;
/** Bytes of `out` with the staged requests behind, the camera's then those ahead, and the kept
 *  snapshot: what the kernels write, more than the frame copies. */
export const stagedOutputBytes = (listCap: number) =>
  (keptSnapshotWord(listCap) + KEPT_HEADER_WORDS + 2 * listCap) * 4;
/** The most ranks an `out` of `bytes` holds: `stagedOutputBytes` read backwards. It grows with
 *  every rank, so the largest cap that fits is found by halving, without a closed form to keep in
 *  step with each region the readout gains. */
export function listCapHeld(bytes: number) {
  let low = 0,
    high = Math.max(0, Math.floor(bytes / 4));
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (stagedOutputBytes(mid) <= bytes) low = mid;
    else high = mid - 1;
  }
  return low;
}
/** Readback slots the cut alternates between (`dispatch.ts`): the cache reads a drawn list at
 *  most this many frames behind the GPU, plus the frame being encoded. */
export const DAG_READBACK_SLOTS = 2;
export const OUT_COUNT = 0,
  OUT_FRUSTUM_REJECTED = 1,
  OUT_LOD_LEVEL = 2,
  OUT_FLAGS = 3,
  OUT_SELECTED_TRIANGLES = 4,
  OUT_TRANSPARENT_TRIANGLES = 5,
  /** How many requests ahead the snapshot holds, behind every one of the camera's (`dagSortRequests`). */
  OUT_AHEAD_PLACED = 7;

/** First residency word, behind the working table's word per page: the cut rule's `resident(c)`
 *  (`../../page/cut/readiness.ts`, `ready`). */
export const residentBase = (pageCount: number) => pageCount;
/** Residency words: one bit per cluster, thirty-two clusters per word. */
export const residentWords = (pageCount: number) => (Math.max(0, pageCount) + 31) >>> 5;
/** First word of the second bit set, the rule's `resident(childGroup(c))` (`childReady`). */
export const childBase = (pageCount: number) => residentBase(pageCount) + residentWords(pageCount);
/** First word of the pool's list: its count, then a canonical page per held slot (`poolList.ts`). */
export const poolBase = (pageCount: number) => childBase(pageCount) + residentWords(pageCount);
/** First word of the key column, one per page: its content key (`evict.ts`). */
export const keyBase = (pageCount: number) => poolBase(pageCount) + 1 + selectionListCap(pageCount);
/** First cold record, behind the bit sets, the pool's list and the key column. */
export const coldBase = (pageCount: number) => keyBase(pageCount) + Math.max(0, pageCount);

/** Hot field ranks, in the order `struct Cluster` of the shader declares them. */
export const HOT_SPHERE = 0,
  HOT_PARENT_SPHERE = 4,
  HOT_LOD_ERROR = 8,
  HOT_PARENT_ERROR = 9,
  HOT_FLAGS = 10;
/** Cold field ranks, in the order `shader/recordWgsl.ts` reads them by word. */
export const COLD_CONE = 0,
  COLD_MIN = 4,
  COLD_HAS_BOX = 7,
  COLD_MAX = 8,
  /** Owner node, relative to the placement's first node: the same for every placement. */
  COLD_OWNER = 11,
  /** Cluster triangles, read as an INTEGER word: those are what the totals accumulate. */
  COLD_TRIANGLES = 12;
