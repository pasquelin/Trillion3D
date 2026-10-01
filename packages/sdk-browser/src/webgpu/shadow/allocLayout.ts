import { MAX_SHADOW_SLICES, SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import {
  SUN_WINDOW,
  shadowRequestCap,
  shadowTableEntries,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { FRESH_FACE_WORDS, FRESH_PARAMS, freshArgWords } from './freshLayout.ts';

// The layout and the sizes of the shadow requests and of the GPU allocation's buffers, read
// before any pass is built — the pool's grant and the memory budget's shadow share
// (`../../residency/shadowBudgetBytes.ts`) — kept apart from the shader texts and pipelines, so
// that the CDN core, which holds the budget, holds none of the WebGPU shadow passes (#1353).

/** A page's fields in the GPU pool, one array of `pages` words each after the counts: the entry
 *  it maps (−1 free) and the frame it was last asked in first, the words a snapshot reads back;
 *  last, which draw its entry's depth came from (`DRAWN_*`). */
export const POOL_FIELDS = [
  'owner',
  'requested',
  'rank',
  'view',
  'x',
  'y',
  'generation',
  'drawnBy',
] as const;
/** The counts the allocation keeps, before the fields: what a snapshot reads back with them. Each
 *  frame's allocation clears those before `listings`, the pages every frame since the pool's seed
 *  listed (`listDraw`): a snapshot read after a lost one still shows that the GPU drew. Last, the
 *  pairs the latest GPU page draws counted (`sealShadowPages`), which grow their list
 *  (`pairGrowth.ts`). */
export const POOL_COUNTS = [
  'needs',
  'candidates',
  'allocated',
  'refused',
  'drawn',
  'listings',
  'pairs',
] as const;
/** Words of the parameters before the host's asks: frame, pages, list cap, asks, where the
 *  candidates' keys start, the first frame whose asks no need evicts, then each slice's
 *  generation. */
export const ALLOC_PARAM_WORDS = 8 + MAX_SHADOW_SLICES;
/** Words of the header of the words the host sends: their count, the pool's pages, the frame, one
 *  free. */
export const WORDS_HEADER = 4;

/** Words of one bit per table entry of a session's window. */
export const shadowEntryBits = (pages = SUN_WINDOW) => shadowTableEntries(pages) / 32;
/** Bytes of the request buffer of a pool of `pages` (`pageRequests.ts`): the count, the list, one
 *  bit per table entry of the session's `sunWindow` (`shadowRequestWgsl.ts`). */
export const shadowRequestBufferBytes = (pages: number, sunWindow = SUN_WINDOW) =>
  (1 + shadowRequestCap(pages) + shadowEntryBits(sunWindow)) * 4;

/** The power of two at least `n`: what a bitonic sort of `n` keys spans. */
export const spanOf = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));
/** Pairs the host's table words hold at most: the table's changed words of a frame, or every
 *  mapped page once (`table.ts`, `flush`). */
export const wordsCap = (pages: number) => 4 * pages;

export type Usage = keyof typeof GPUBufferUsage;
/** Words of each buffer of the allocation of a pool of `pages`, with its label and its usages
 *  beside `STORAGE`: its pool, keys, parameters and words, then the draw list, parameters,
 *  arguments, dispatch, views and volumes of the pages the GPU draws itself. */
export const allocationBuffers = (pages: number) =>
  ({
    state: ['GPU pool', POOL_COUNTS.length + POOL_FIELDS.length * pages, ['COPY_DST', 'COPY_SRC']],
    keys: ['allocation keys', spanOf(shadowRequestCap(pages)) + spanOf(pages), []],
    params: ['allocation', ALLOC_PARAM_WORDS + shadowRequestCap(pages), ['COPY_DST']],
    words: ['table words', WORDS_HEADER + 2 * wordsCap(pages), ['COPY_DST']],
    drawList: ['GPU draw list', pages, []],
    freshParams: ['GPU pages', FRESH_PARAMS, ['COPY_DST']],
    freshArgs: ['GPU page draws', freshArgWords(pages), ['INDIRECT']],
    freshDispatch: ['GPU page cull', 3, ['INDIRECT']],
    freshFaces: ['GPU page views', pages * FRESH_FACE_WORDS, []],
    freshVolumes: ['GPU page volumes', pages * SHADOW_CULL_FLOATS, []],
  }) satisfies Record<string, [string, number, Usage[]]>;

/** GPU bytes of the allocation of a pool of `pages`: every buffer it makes. */
export const shadowAllocationBytes = (pages: number) =>
  Object.values(allocationBuffers(pages)).reduce((sum, [, words]) => sum + 4 * words, 0);

/** Bytes of the request buffer of a pool of `pages` — the count, the list, one bit per table
 *  entry of the session's `sunWindow` —, and of the buffers its pages are allocated in on the GPU
 *  (`allocBuffers.ts`). */
export const shadowRequestBytes = (pages: number, sunWindow = SUN_WINDOW) =>
  shadowRequestBufferBytes(pages, sunWindow) + shadowAllocationBytes(pages);
