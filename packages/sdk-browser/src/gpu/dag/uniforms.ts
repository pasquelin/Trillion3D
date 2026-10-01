import type { DagViewUniforms, PackedDag } from './types.ts';
import { requestPage } from './request.ts';
import {
  OUT_AHEAD_PLACED,
  OUT_COUNT,
  OUT_FLAGS,
  OUT_FRUSTUM_REJECTED,
  OUT_LOD_LEVEL,
  OUT_SELECTED_TRIANGLES,
  OUT_TRANSPARENT_TRIANGLES,
  SELECTION_HEADER_WORDS,
  evictionWord,
} from './layout.ts';
import type { SelectionResult } from '../core/selection.ts';
import { VIEW_APPEND, VIEW_LIGHT, VIEW_PAGES } from './shader/pagesWgsl.ts';
import { DAG_VIEW_WORDS } from './shader/viewsWgsl.ts';
import { AHEAD_VIEW } from './shader/aheadWgsl.ts';
import { VIEW_BLOCK_WORDS, viewWord } from './viewLayout.ts';

/** A light cut's views: how many it runs, how many it holds, its queues' bound, and whether it
 *  appends to the requests an earlier batch of the frame listed (`VIEW_APPEND`). */
export type DagCutViews = { count: number; capacity: number; queueCap: number; append?: boolean };

/**
 * Arrays of a readback slot, reused from one read to the next: reallocating them on every
 * readback threw tens of thousands of elements at the garbage collector, to rewrite exactly
 * the same ranks.
 */
export type DagOutputScratch = {
  result: SelectionResult;
  drawable: number[];
  ahead: number[];
  evict: number[];
};
export const createDagOutputScratch = (): DagOutputScratch => ({
  result: {
    pageIds: [],
    frustumRejected: 0,
    lodLevel: 0,
    selectedTriangles: 0,
    drawnTriangles: 0,
    transparentTriangles: 0,
  },
  drawable: [],
  ahead: [],
  evict: [],
});

/** The view ahead of a moving camera (`shader/aheadWgsl.ts`): block 1 repeats the camera's with the
 *  planes and view ahead, block 0 says it is there; a light view's short block never carries one. */
function writeAheadBlock(target: Float32Array, ints: Uint32Array, uniforms: DagViewUniforms) {
  const ahead = uniforms.ahead,
    at = AHEAD_VIEW * VIEW_BLOCK_WORDS;
  if (!ahead || uniforms.light || target.length < at + VIEW_BLOCK_WORDS) return;
  target.copyWithin(at, 0, VIEW_BLOCK_WORDS);
  target.set(ahead.planes, at);
  target.set(ahead.view, at + viewWord('view'));
  ints[viewWord('ahead')] = 1;
}

/**
 * One view's block of the uniform array (`shader/viewsWgsl.ts`). Every word is written through
 * `viewWord`, the name the kernels read it by, so a field added to `viewLayout.ts` moves the host
 * and the shader together. `views` says how many views the cut runs and how many its buffers were
 * sized for, and the capacity of each descent queue: a camera runs one view on buffers sized for
 * one, whose queues hold every node. `listCap` is the ranks its readout holds (`listCap.ts`).
 */
export function writeDagUniforms(
  target: Float32Array,
  packed: PackedDag,
  uniforms: DagViewUniforms,
  residentCut: boolean,
  listCap: number,
  views?: DagCutViews,
) {
  const W = viewWord;
  target.fill(0);
  target.set(uniforms.planes, 0);
  target.set(uniforms.view, W('view'));
  target[W('pixelScale')] = uniforms.pixelScale[0];
  target[W('pixelScale') + 1] = uniforms.pixelScale[1];
  target[W('pixelError')] = uniforms.pixelError;
  target[W('near')] = uniforms.near;
  const ints = new Uint32Array(target.buffer, target.byteOffset, target.length);
  ints[W('clusterCount')] = packed.pageCount;
  ints[W('nodeCount')] = packed.nodeCount;
  ints[W('worldCount')] = packed.worldCount;
  ints[W('residentCut')] = residentCut ? 1 : 0;
  const cw = uniforms.cameraWorld;
  if (cw) {
    target[W('cameraWorld')] = cw[0];
    target[W('cameraWorld') + 1] = cw[1];
    target[W('cameraWorld') + 2] = cw[2];
  }
  target[W('cameraStretch')] = uniforms.cameraStretch ?? 1;
  // Sample cap the kernel reads to bound its two halves and to say, when it happens, that it
  // truncated (`listCap.ts`).
  ints[W('listCap')] = listCap;
  // The projection's clip-w weight: 1 perspective, 0 orthographic (`screenErrorBound.ts`).
  target[W('perspective')] = uniforms.perspective ?? 1;
  // A light cut's view: its kind, then the face pages it draws into (`shader/pagesWgsl.ts`).
  ints[W('viewCount')] = views?.count ?? 1;
  ints[W('viewCapacity')] = views?.capacity ?? 1;
  ints[W('queueCap')] = views?.queueCap ?? packed.nodeCount;
  const light = uniforms.light;
  ints[W('viewFlags')] = light ? VIEW_LIGHT | VIEW_PAGES | (views?.append ? VIEW_APPEND : 0) : 0;
  writeAheadBlock(target, ints, uniforms);
  if (!light) return;
  ints[W('pageRows')] = light.rows;
  ints[W('pageMask')] = light.mask[0];
  ints[W('pageMask') + 1] = light.mask[1];
  target[W('clipScale')] = light.clipScale;
  target[W('clipPad')] = light.clipPad;
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
  const head = SELECTION_HEADER_WORDS,
    held = Math.max(0, (drawnWordOffset || ints.length) - head);
  // Arrays sized in advance: reading a frame does not grow an empty array element by element,
  // and a typed-array iterator is never unrolled.
  const { result, drawable, evict } = scratch,
    pageIds = result.pageIds;
  // Each rank is a REQUEST: the page and its priority in one word (`request.ts`). The GPU wrote
  // them SORTED (`shader/snapshotWgsl.ts`): the camera's, counted on their own, then as many of the
  // view ahead's as the cap left. The host reads them in that order and ranks nothing.
  const ahead = scratch.ahead,
    visible = Math.min(ints[OUT_COUNT] ?? 0, held),
    count = visible + Math.min(ints[OUT_AHEAD_PLACED] ?? 0, held - visible);
  pageIds.length = visible;
  ahead.length = count - visible;
  for (let i = 0; i < visible; i++) pageIds[i] = requestPage(ints[head + i]);
  for (let i = visible; i < count; i++) ahead[i - visible] = requestPage(ints[head + i]);
  result.aheadPageIds = ahead;
  result.frustumRejected = ints[OUT_FRUSTUM_REJECTED] ?? 0;
  result.lodLevel = ints[OUT_LOD_LEVEL] ?? 0;
  // Totals the GPU holds: they describe the cut, not the list that reports it, so a truncated
  // sample still returns them correctly (`shader/totalsWgsl.ts`).
  result.selectedTriangles = ints[OUT_SELECTED_TRIANGLES] ?? 0;
  result.transparentTriangles = ints[OUT_TRANSPARENT_TRIANGLES] ?? 0;
  // The rule draws what it selects: one counter, published under both names.
  result.drawnTriangles = result.selectedTriangles;
  // Bit 1: the cut did not fit under the sample cap. This is not a GPU fault — the kernels ran,
  // the frame mask is correct — but the reported LIST is truncated, and nothing that lives off
  // it must take it for the whole cut.
  result.truncated = ((ints[OUT_FLAGS] ?? 0) & 1) !== 0;
  result.drawablePageIds = undefined;
  // The drawable list arrives already compacted, in increasing order: the CPU no longer walks
  // one flag per DAG page, only the ranks the GPU kept.
  if (drawnWordOffset) {
    result.drawablePageIds = readCountedList(ints, drawnWordOffset, drawable);
    result.evictPageIds = readCountedList(ints, evictionWord(drawnWordOffset - head), evict);
  }
  return result;
}

/** A list the GPU wrote behind a header at word `at`: its count, bounded by what the readback
 *  holds, then its ranks, copied into `into`. */
function readCountedList(ints: Uint32Array, at: number, into: number[]) {
  into.length = Math.min(ints[at] ?? 0, Math.max(0, ints.length - at - SELECTION_HEADER_WORDS));
  for (let i = 0; i < into.length; i++) into[i] = ints[at + SELECTION_HEADER_WORDS + i];
  return into;
}
