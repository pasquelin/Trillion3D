import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import {
  LAYER_PAGES,
  PAGE_INDEX_MASK,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Layers a pool holds at most: a table word names 2¹⁶ pages (`shadowPoolShape`). */
export const MAX_POOL_LAYERS = (PAGE_INDEX_MASK + 1) / LAYER_PAGES;
/** Words of the parameters before the slices: pages, layer side, layers, the rows the cull tests
 *  — the table's, then the blended casters' `[blendFirst, blendEnd)` —, the pairs it may keep. */
export const FRESH_PARAM_WORDS = 8;
/** Floats of a slice's parameters: its emitter — centre and envelope radius —, its far plane. */
export const FRESH_SLICE_FLOATS = 8;
/** Words of the parameters, header and slices. */
export const FRESH_PARAMS = FRESH_PARAM_WORDS + MAX_SHADOW_SLICES * FRESH_SLICE_FLOATS;
/** Words of a GPU page's view, as the depth pass reads it (`ShadowView`): matrix, `params`,
 *  emitter, clip square. */
export const FRESH_FACE_WORDS = 28;
/** A draw's first vertex carries its layer this many bits up; its corner is below. */
export const FRESH_LAYER_SHIFT = 16;

/**
 * THE WORDS OF THE GPU PAGES' ARGUMENTS (#1275), one buffer the passes share: the frame's region
 * count, the pairs the list keeps — its admitted regions' —, the most corners a kept caster draws,
 * the pairs every region counted (#1363); per pool layer two indirect draws — its pages cleared,
 * its casters — then the first region of each layer, the page of each region, and each region's
 * pairs: counted, then its first place in the list or `FRESH_SHORT` (`freshCullWgsl.ts`). The
 * cull's dispatch is apart: a buffer a dispatch reads its size from, it may not write
 * (`dispatch`, `allocBuffers.ts`).
 */
export const FRESH_ARG = { regions: 0, pairs: 1, corners: 2, need: 3 } as const;
/** Draws of a layer: its pages' squares cleared, then every kept caster. */
export const FRESH_CLEAR = 0,
  FRESH_CASTERS = 1;
export const DRAWS = 4,
  DRAW_WORDS = 4;
/** First word of layer `layer`'s draw `kind`. */
export const freshDrawWord = (layer: number, kind: number) =>
  DRAWS + (layer * 2 + kind) * DRAW_WORDS;
export const FRESH_LAYER_STARTS = DRAWS + MAX_POOL_LAYERS * 2 * DRAW_WORDS;
export const FRESH_REGION_PAGES = FRESH_LAYER_STARTS + MAX_POOL_LAYERS;
/** A region's pairs word once the pair cull's admission found the list could not hold them all
 *  (#1363): none of them is kept, and the seal leaves its page unreadable (`sealShadowPages`). No
 *  place in a list is this word. */
export const FRESH_SHORT = 2 ** 32 - 1;
/** Words of the arguments of a pool of `pages`: its regions' pages, then their pairs
 *  (`freshRegionPairs`, `freshLayoutWgsl.ts`). */
export const freshArgWords = (pages: number) => FRESH_REGION_PAGES + 2 * pages;
