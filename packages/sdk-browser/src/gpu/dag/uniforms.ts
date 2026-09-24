import type { PackedDag } from './types.ts';
import { REQUEST_PRIORITY_MAX, requestPage, requestPriority } from './request.ts';
import {
  OUT_COUNT,
  OUT_DRAWN_TRIANGLES,
  OUT_FLAGS,
  OUT_FRUSTUM_REJECTED,
  OUT_LOD_LEVEL,
  OUT_SELECTED_TRIANGLES,
  OUT_TRANSPARENT_TRIANGLES,
  OUT_UNCOVERED_TRIANGLES,
  SELECTION_HEADER_WORDS,
  selectionListCap,
} from './layout.ts';
import type { SelectionResult } from '../core/selection.ts';
import type { DagViewUniforms } from './types.ts';
import { VIEW_LIGHT, VIEW_PAGES } from './shader/pagesWgsl.ts';

/** The views one cut runs, the views its buffers hold, and the capacity of each descent queue. */
export type DagCutViews = { count: number; capacity: number; queueCap: number };

/**
 * Arrays of a readback slot, reused from one read to the next: reallocating them on every
 * readback threw tens of thousands of elements at the garbage collector, to rewrite exactly
 * the same ranks.
 */
export type DagOutputScratch = {
  result: SelectionResult;
  drawable: number[];
  /** Counting-sort buckets, one per priority step. Fixed size, allocated once: ranking never
   *  returns anything to the garbage collector, whatever the sample size. */
  seaux: Uint32Array;
};
export const createDagOutputScratch = (): DagOutputScratch => ({
  result: {
    pageIds: [],
    frustumRejected: 0,
    lodLevel: 0,
    selectedTriangles: 0,
    drawnTriangles: 0,
    uncoveredTriangles: 0,
    transparentTriangles: 0,
  },
  drawable: [],
  seaux: new Uint32Array(REQUEST_PRIORITY_MAX + 1),
});

/**
 * One view's block of the uniform array (`shader/viewsWgsl.ts`). `views` says how many views the
 * cut runs and how many its buffers were sized for, and the capacity of each descent queue: a
 * camera runs one view on buffers sized for one, whose queues hold every node.
 */
export function writeDagUniforms(
  target: Float32Array,
  packed: PackedDag,
  uniforms: DagViewUniforms,
  residentCut: boolean,
  views?: DagCutViews,
) {
  target.fill(0);
  target.set(uniforms.planes, 0);
  target.set(uniforms.view, 24);
  target[40] = uniforms.pixelScale[0];
  target[41] = uniforms.pixelScale[1];
  target[42] = uniforms.pixelError;
  target[43] = uniforms.near;
  const ints = new Uint32Array(target.buffer, target.byteOffset, target.length);
  ints[44] = packed.pageCount;
  ints[45] = packed.nodeCount;
  ints[46] = packed.worldCount;
  ints[47] = residentCut ? 1 : 0;
  const cw = uniforms.cameraWorld;
  if (cw) {
    target[48] = cw[0];
    target[49] = cw[1];
    target[50] = cw[2];
  }
  target[51] = uniforms.cameraStretch ?? 1;
  // Sample cap the kernel reads to bound its two halves and to say, when it happens, that it
  // truncated (`layout.ts`).
  ints[52] = selectionListCap(packed.pageCount);
  // The projection's clip-w weight: 1 perspective, 0 orthographic (`screenErrorBound.ts`).
  target[53] = uniforms.perspective ?? 1;
  // A light cut's view: its kind, then the face pages it draws into (`shader/pagesWgsl.ts`).
  ints[60] = views?.count ?? 1;
  ints[61] = views?.capacity ?? 1;
  ints[62] = views?.queueCap ?? packed.nodeCount;
  const light = uniforms.light;
  ints[54] = light ? VIEW_LIGHT | VIEW_PAGES : 0;
  if (!light) return;
  ints[55] = light.rows;
  ints[56] = light.mask[0];
  ints[57] = light.mask[1];
  target[58] = light.clipScale;
  target[59] = light.clipPad;
}

/** `drawnWordOffset`: rank of the compacted-list count in the sample, 0 when there is none. */
export function parseDagOutput(
  bytes: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
  drawnWordOffset: number,
  scratch: DagOutputScratch = createDagOutputScratch(),
): SelectionResult | null {
  const ints = new Uint32Array(bytes, byteOffset, Math.floor(byteLength / 4));
  const head = SELECTION_HEADER_WORDS;
  const count = Math.min(
    ints[OUT_COUNT] ?? 0,
    Math.max(0, (drawnWordOffset || ints.length) - head),
  );
  // Arrays sized in advance: reading a frame does not grow an empty array element by element,
  // and a typed-array iterator is never unrolled.
  const { result, drawable, seaux } = scratch,
    pageIds = result.pageIds;
  // Each rank is a REQUEST: the page and its priority in one word (`request.ts`). The list
  // is returned SORTED, decreasing priority — that is the order the host uploads in, and what
  // the WebGL2 path has always done (`orderPendingUrls`).
  //
  // COUNTING SORT, not comparison. Priority is already quantized to ten bits: one thousand
  // twenty-four buckets cover it entirely, and two walks suffice — one to count, one to place.
  // No comparison, no callback, no intermediate buffer: the list is read from the sample and
  // written straight into `pageIds`, where a rank sort needed three ordinary arrays grown by
  // `.length =` and n·log n closure calls on 262 144 ranks at the cap.
  //
  // It is STABLE, and that is what makes it substitutable: at equal priority the order stays
  // that of the sample, exactly what the comparison sort it replaces returned.
  pageIds.length = count;
  seaux.fill(0);
  for (let i = 0; i < count; i++) seaux[requestPriority(ints[head + i])]++;
  // Prefix sum run from the HIGHEST priority to the lowest: the list comes out decreasing
  // without having to reverse it.
  let place = 0;
  for (let p = REQUEST_PRIORITY_MAX; p >= 0; p--) {
    const tenus = seaux[p];
    seaux[p] = place;
    place += tenus;
  }
  for (let i = 0; i < count; i++) {
    const word = ints[head + i];
    pageIds[seaux[requestPriority(word)]++] = requestPage(word);
  }
  result.frustumRejected = ints[OUT_FRUSTUM_REJECTED] ?? 0;
  result.lodLevel = ints[OUT_LOD_LEVEL] ?? 0;
  result.complete = ((ints[OUT_FLAGS] ?? 0) & 2) === 0;
  // Totals the GPU holds: they describe the cut, not the list that reports it, so a truncated
  // sample still returns them correctly (`shader/totalsWgsl.ts`).
  result.selectedTriangles = ints[OUT_SELECTED_TRIANGLES] ?? 0;
  result.transparentTriangles = ints[OUT_TRANSPARENT_TRIANGLES] ?? 0;
  result.drawnTriangles = ints[OUT_DRAWN_TRIANGLES] ?? 0;
  result.uncoveredTriangles = ints[OUT_UNCOVERED_TRIANGLES] ?? 0;
  // Bit 1: the cut did not fit under the sample cap. This is not a GPU fault — the kernels ran,
  // the frame mask is correct — but the reported LIST is truncated, and nothing that lives off
  // it must take it for the whole cut.
  result.truncated = ((ints[OUT_FLAGS] ?? 0) & 1) !== 0;
  result.drawablePageIds = undefined;
  // The drawable list arrives already compacted, in increasing order: the CPU no longer walks
  // one flag per DAG page, only the ranks the GPU kept.
  if (drawnWordOffset) {
    const drawnCount = Math.min(
      ints[drawnWordOffset] ?? 0,
      Math.max(0, ints.length - drawnWordOffset - head),
    );
    drawable.length = drawnCount;
    for (let i = 0; i < drawnCount; i++) drawable[i] = ints[drawnWordOffset + head + i];
    result.drawablePageIds = drawable;
  }
  return result;
}
