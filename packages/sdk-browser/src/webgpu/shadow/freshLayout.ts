import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import {
  LAYER_PAGES,
  PAGE_INDEX_MASK,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** Layers a pool holds at most: a table word names 2¹⁶ pages (`shadowPoolShape`). */
export const MAX_POOL_LAYERS = (PAGE_INDEX_MASK + 1) / LAYER_PAGES;
/** Words of the parameters before the slices: pages, layer side, layers, the rows the cull tests
 *  — the table's, then the blended casters' `[blendFirst, blendEnd)` —, the pairs it may keep, the
 *  error in texels the casters are chosen at (`f32`, #831). */
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
 * the pairs every region counted (#1363), the still casters' pairs kept from the list's start, the
 * moving ones' kept from its end down, and the list's last place (#831); per pool layer four
 * indirect draws — its pages cleared, every kept caster, the still ones, the moving ones — then the
 * first region of each layer, the page of each region, and each region's pairs: counted, then its
 * place among the admitted pairs or `FRESH_SHORT` (`freshCullWgsl.ts`). The cull's dispatch is
 * apart: a buffer a dispatch reads its size from, it may not write (`dispatch`, `allocBuffers.ts`).
 */
export const FRESH_ARG = {
  regions: 0,
  pairs: 1,
  corners: 2,
  need: 3,
  still: 4,
  moving: 5,
  last: 6,
} as const;
/** Draws of a layer: its pages' squares cleared, every kept caster, the still casters alone — the
 *  static layer's draw —, the moving ones alone (#831). */
export const FRESH_CLEAR = 0,
  FRESH_CASTERS = 1,
  FRESH_STILL = 2,
  FRESH_MOVING = 3,
  FRESH_KINDS = 4;
export const DRAWS = 8,
  DRAW_WORDS = 4;
/** First word of layer `layer`'s draw `kind`. */
export const freshDrawWord = (layer: number, kind: number) =>
  DRAWS + (layer * FRESH_KINDS + kind) * DRAW_WORDS;
export const FRESH_LAYER_STARTS = DRAWS + MAX_POOL_LAYERS * FRESH_KINDS * DRAW_WORDS;
export const FRESH_REGION_PAGES = FRESH_LAYER_STARTS + MAX_POOL_LAYERS;
/** A region's pairs word once the pair cull's admission found the list could not hold them all
 *  (#1363): none of them is kept, and the seal leaves its page unreadable (`sealShadowPages`). No
 *  place in a list is this word. */
export const FRESH_SHORT = 2 ** 32 - 1;
/** Words of the arguments of a pool of `pages`: its regions' pages, then their pairs
 *  (`freshRegionPairs`, `freshLayoutWgsl.ts`). */
export const freshArgWords = (pages: number) => FRESH_REGION_PAGES + 2 * pages;
