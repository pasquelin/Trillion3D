import { MAX_SHADOW_SLICES } from '../../../../sdk-core/src/index.ts';
import {
  DRAWS,
  DRAW_WORDS,
  FRESH_ARG,
  FRESH_KINDS,
  FRESH_LAYER_SHIFT,
  FRESH_LAYER_STARTS,
  FRESH_REGION_PAGES,
  FRESH_SHORT,
} from './freshLayout.ts';

/** The layout of `freshLayout.ts` as WGSL constants: every pass that reads the arguments. */
export const FRESH_LAYOUT_WGSL = `
const FRESH_REGIONS:u32=${FRESH_ARG.regions}u;
const FRESH_PAIRS:u32=${FRESH_ARG.pairs}u;
const FRESH_CORNERS:u32=${FRESH_ARG.corners}u;
const FRESH_NEED:u32=${FRESH_ARG.need}u;
const FRESH_STILL_PAIRS:u32=${FRESH_ARG.still}u;
const FRESH_MOVING_PAIRS:u32=${FRESH_ARG.moving}u;
const FRESH_LAST_PAIR:u32=${FRESH_ARG.last}u;
const FRESH_DRAWS:u32=${DRAWS}u;
const FRESH_LAYER_STARTS:u32=${FRESH_LAYER_STARTS}u;
const FRESH_REGION_PAGES:u32=${FRESH_REGION_PAGES}u;
const FRESH_SHORT:u32=${FRESH_SHORT}u;
const FRESH_LAYER_SHIFT:u32=${FRESH_LAYER_SHIFT}u;
const FRESH_CORNER_MASK:u32=${2 ** FRESH_LAYER_SHIFT - 1}u;
fn freshDraw(layer:u32,kind:u32)->u32{return FRESH_DRAWS+(layer*${FRESH_KINDS}u+kind)*${DRAW_WORDS}u;}
fn freshRegionPairs(pages:u32,k:u32)->u32{return FRESH_REGION_PAGES+pages+k;}`;

/** The parameters as every pass declares them (`writeFresh`, `allocBuffers.ts`). */
export const FRESH_PARAMS_WGSL = `struct ShadowFreshSlice{emitter:vec4f,far:vec4f,}
struct ShadowFreshParams{pages:u32,side:u32,layers:u32,rows:u32,blendFirst:u32,blendEnd:u32,capacity:u32,threshold:f32,slices:array<ShadowFreshSlice,${MAX_SHADOW_SLICES}>,}`;
