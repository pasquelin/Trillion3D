/**
 * Compact cut layout, written once by packing and reread by two readers: the shader
 * (`shader/shader.ts`, `shader/recordWgsl.ts`) and the oracle (`records.ts`). Both
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

/** Words of the hot record: `struct Cluster` of the shader holds eleven, and WGSL rounds its
 *  stride to sixteen bytes — the twelfth word is that padding. */
export const CLUSTER_WORDS = 12;
/** Words of the cold record; `PAGE_CONE_FLOATS` in `../core/selection.ts` is the public mirror. */
export const COLD_WORDS = 13;
export const CLUSTER_ROOT = 1,
  CLUSTER_NEVER = 2,
  /** The cluster is blended: its triangle share is counted apart, as on the CPU. */
  CLUSTER_TRANSPARENT = 4;
/** Detail level travels in the flags' high bits: a single pass reads it, at emit. */
export const CLUSTER_LEVEL_SHIFT = 8;
const CLUSTER_LEVEL_MAX = 0xffffff;

export function packClusterFlags(
  root: boolean,
  never: boolean,
  level: number,
  transparent = false,
) {
  const bounded = Math.min(Math.max(Math.trunc(level) || 0, 0), CLUSTER_LEVEL_MAX);
  return (
    ((root ? CLUSTER_ROOT : 0) |
      (never ? CLUSTER_NEVER : 0) |
      (transparent ? CLUSTER_TRANSPARENT : 0) |
      (bounded << CLUSTER_LEVEL_SHIFT)) >>>
    0
  );
}
export const clusterLevel = (flags: number) => flags >>> CLUSTER_LEVEL_SHIFT;

/**
 * Readout CAP, in ranks, for each of its two halves.
 *
 * The readout buffer was sized on `pageCount` — the worst case, a cut that would keep
 * the whole catalogue — and the frame copy took all of it: 15.2 MiB per frame at
 * 1,992,187 clusters, for a cut that keeps about a hundredth. Measured on apple metal-3
 * (`tests/browser/probes/cut-snapshot-gpu.ts`): 1.17 ms per frame for the full readout vs
 * 0.52 ms for a capped readout, when the kernels themselves cost 0.99.
 *
 * The cap is WIDE next to a real cut: the same bench keeps 7,812 ranks of 1,992,187 at
 * threshold 64, 31,250 at threshold 16. Overflow remains possible — a camera placed in
 * the geometry at a tiny threshold — and it is SAID: the kernel sets the overflow bit,
 * the readout is declared truncated and the frame falls back to the CPU cut, which
 * knows how to pick a representable subset. A truncated readout is never adopted as if
 * it were whole.
 */
export const SELECTION_LIST_CAP = 262144;
/** Cap of a scene: never more than its catalogue, which no cut can exceed. */
export const selectionListCap = (pageCount: number) =>
  Math.min(Math.max(0, pageCount), SELECTION_LIST_CAP);

/**
 * Readout header, in words, in front of each of its two halves.
 *
 * The first four are the usual — count, trunk reject, reached level, flags. The next
 * four carry the TRIANGLE TOTALS, which only the GPU sums. The kernels hold them where
 * the verdict is spoken: `dagWanted` knows what the cut keeps, `dagMask` knows what goes
 * to draw and what is missing. Their relation stays `selected − drawn − uncovered = 0`.
 *
 * That is the condition for the readout to one day stop carrying LISTS: a total
 * held by the GPU survives the disappearance of the list it was the sum of.
 */
export const SELECTION_HEADER_WORDS = 8;
export const OUT_COUNT = 0,
  OUT_FRUSTUM_REJECTED = 1,
  OUT_LOD_LEVEL = 2,
  OUT_FLAGS = 3,
  OUT_SELECTED_TRIANGLES = 4,
  OUT_TRANSPARENT_TRIANGLES = 5,
  OUT_DRAWN_TRIANGLES = 6,
  OUT_UNCOVERED_TRIANGLES = 7;

/**
 * The four triangle totals placed in the header, in the order THIS file fixes. `dagMask`
 * writes them on the GPU (`shader/totalsWgsl.ts`); anything that stands in for the GPU
 * must write them the same way, or else adoption — which reads the GPU first — would
 * take an empty header for a frame without triangles.
 */
export function writeTriangleTotals(
  ints: Uint32Array,
  totaux: {
    selectedTriangles?: number;
    transparentTriangles?: number;
    drawnTriangles?: number;
    uncoveredTriangles?: number;
  },
) {
  ints[OUT_SELECTED_TRIANGLES] = totaux.selectedTriangles ?? 0;
  ints[OUT_TRANSPARENT_TRIANGLES] = totaux.transparentTriangles ?? 0;
  ints[OUT_DRAWN_TRIANGLES] = totaux.drawnTriangles ?? 0;
  ints[OUT_UNCOVERED_TRIANGLES] = totaux.uncoveredTriangles ?? 0;
}

/** First residency word, behind the working table's word per page. */
export const residentBase = (pageCount: number) => pageCount;
/** Residency words: one bit per cluster, thirty-two clusters per word. */
export const residentWords = (pageCount: number) => (Math.max(0, pageCount) + 31) >>> 5;
/** First cold record, behind the residency words. */
export const coldBase = (pageCount: number) => residentBase(pageCount) + residentWords(pageCount);
export const residentBit = (bits: Uint32Array, base: number, page: number) =>
  (bits[base + (page >>> 5)] & (1 << (page & 31))) !== 0;

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

/**
 * Residency column returned to the oracle, one word per cluster: what the buffer
 * doubles read in the same cold buffer as the shader, instead of a rank copied on their side.
 */
export function residentFlags(bits: Uint32Array, pageCount: number) {
  const base = residentBase(pageCount);
  return Uint32Array.from({ length: pageCount }, (_, page) =>
    residentBit(bits, base, page) ? 1 : 0,
  );
}
