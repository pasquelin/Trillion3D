import { pageModel, type PageModel } from './pageModel.ts';
import type { PageOps } from './pageOps.ts';
import { LAMP_MIPS, LAMP_SIDE, SUN_LEVELS, SUN_WINDOW } from './virtual.ts';

/** A literal, parenthesised when negative. */
const literal = (text: string) => (text.startsWith('-') ? `(${text})` : text);

/** The page model's operations printed as WGSL: integers are `i32`, floats `f32`. */
export const PAGE_OPS_WGSL: PageOps<string> = {
  int: (n) => literal(String(n)),
  float: (n) => literal(Number.isInteger(n) ? `${n}.0` : String(n)),
  add: (a, b) => `(${a}+${b})`,
  sub: (a, b) => `(${a}-${b})`,
  neg: (a) => `(-${a})`,
  mul: (a, b) => `(${a}*${b})`,
  div: (a, b) => `(${a}/${b})`,
  mod: (a, b) => `(${a}%${b})`,
  // An `i32` shifted by a `u32`, whatever literal it starts from.
  shr: (a, b) => `(i32(${a})>>u32(${b}))`,
  max: (a, b) => `max(${a},${b})`,
  min: (a, b) => `min(${a},${b})`,
  clamp: (a, low, high) => `clamp(${a},${low},${high})`,
  floor: (a) => `floor(${a})`,
  log2: (a) => `log2(${a})`,
  exp2: (a) => `exp2(${a})`,
  asin: (a) => `asin(${a})`,
  toInt: (a) => `i32(${a})`,
  toFloat: (a) => `f32(${a})`,
  lt: (a, b) => `(${a}<${b})`,
  ge: (a, b) => `(${a}>=${b})`,
  or: (a, b) => `(${a}||${b})`,
  pick: (when, yes, no) => `select(${no},${yes},${when})`,
};

/** Each formula's WGSL parameters, then its return type. */
const SIGNATURES: Record<keyof PageModel<string>, string[]> = {
  shadowRing: ['v:i32', 'n:i32', 'i32'],
  shadowRingPageEntry: ['pages:i32', 'x:i32', 'y:i32', 'i32'],
  shadowFacePageEntry: ['pages:i32', 'x:i32', 'y:i32', 'i32'],
  shadowSunLevelEntry: ['level:i32', 'i32'],
  shadowLampMapEntry: ['face:i32', 'mip:i32', 'i32'],
  shadowLampEntryMip: ['rest:i32', 'i32'],
  shadowLampMipPages: ['mip:i32', 'i32'],
  shadowLampEntryLocal: ['rest:i32', 'i32'],
  shadowFacePageX: ['pages:i32', 'local:i32', 'i32'],
  shadowFacePageY: ['pages:i32', 'local:i32', 'i32'],
  shadowLampView: ['face:i32', 'mip:i32', 'i32'],
  shadowSunSlotLevel: ['slot:i32', 'finest:i32', 'i32'],
  shadowRingPage: ['r:i32', 'origin:i32', 'pages:i32', 'i32'],
  shadowWindowHolds: ['v:i32', 'first:i32', 'count:i32', 'i32'],
  shadowSunCoarseness: ['level:i32', 'finest:i32', 'i32'],
  shadowLampCoarseness: ['mip:i32', 'i32'],
  shadowSunLevelOf: ['footprint:f32', 'i32'],
  shadowSunReadLevel: ['footprint:f32', 'finest:i32', 'i32'],
  shadowSunTexelMetres: ['level:i32', 'f32'],
  shadowSunMapTexel: ['u:f32', 'origin:i32', 'level:i32', 'f32'],
  shadowPageOfTexel: ['t:f32', 'i32'],
  shadowLampFinestTexel: ['tanHalf:f32', 'radius:f32', 'f32'],
  shadowLampReadMip: ['footprint:f32', 'texel0:f32', 'i32'],
  shadowLampMapTexel: ['ndc:f32', 'side:f32', 'f32'],
  shadowPcfEdge: ['t:f32', 'first:f32', 'i32'],
  shadowRegionLow: ['pages:f32', 'x:f32', 'f32'],
  shadowRegionHigh: ['pages:f32', 'x:f32', 'f32'],
  shadowCropScale: ['low:f32', 'high:f32', 'f32'],
  shadowCropOffset: ['low:f32', 'high:f32', 'f32'],
  shadowSunSquareCentre: ['x:f32', 'cells:f32', 'metres:f32', 'f32'],
  shadowAtlasClip: ['origin:f32', 'size:f32', 'f32'],
  shadowPcfStep: ['t:f32', 'first:f32', 'i32'],
  shadowCropped: ['x:f32', 'w:f32', 'scale:f32', 'offset:f32', 'f32'],
  shadowOrthoScale: ['h:f32', 'f32'],
  shadowOrthoDepthScale: ['far:f32', 'f32'],
  shadowOrthoDepthOffset: ['far:f32', 'f32'],
  shadowConeHalfAngle: ['chord:f32', 'halfFov:f32', 'f32'],
  shadowSunEye: ['r:f32', 'u:f32', 'f:f32', 'x:f32', 'y:f32', 'zNear:f32', 'f32'],
  shadowAlong: ['p:f32', 'd:f32', 's:f32', 'f32'],
  shadowBoxMid: ['low:f32', 'high:f32', 'h:f32', 'f32'],
  shadowBoxHalf: ['low:f32', 'high:f32', 'h:f32', 'f32'],
  shadowNeedKey: ['rank:i32', 'entry:i32', 'i32'],
  shadowEvictionKey: ['age:i32', 'rank:i32', 'page:i32', 'i32'],
  shadowReadableWord: ['page:u32', 'range:u32', 'footprintBits:u32', 'u32'],
};

/** The WGSL names of the page model's functions: what a test running the shaders in Node lists. */
export const PAGE_MODEL_FUNCTIONS = Object.keys(SIGNATURES) as Array<keyof PageModel<string>>;

/**
 * The page model as the shaders compile it (`pageModel.ts`): the layout constants they index
 * with — the sun extent a session runs with, the ordinary constant by default —, then one
 * function per formula, each the printed formula the scheduler evaluates.
 */
export const pageModelWgsl = (windowPages = SUN_WINDOW) => {
  const printed = pageModel(PAGE_OPS_WGSL, windowPages) as unknown as Record<
    string,
    (...names: string[]) => string
  >;
  return `
const SUN_LEVEL_COUNT:i32=${SUN_LEVELS};
const SUN_WINDOW_PAGES:i32=${windowPages};
const LAMP_PAGE_COUNT:u32=${LAMP_SIDE}u;
const LAMP_MIP_COUNT:u32=${LAMP_MIPS}u;
${PAGE_MODEL_FUNCTIONS.map((name) => {
  const signature = SIGNATURES[name],
    params = signature.slice(0, -1);
  const body = printed[name](...params.map((param) => param.split(':')[0]));
  return `fn ${name}(${params.join(',')})->${signature[signature.length - 1]}{return ${body};}`;
}).join('\n')}`;
};

/** The page model of the ordinary extent: what a session without reference mode compiles. */
export const PAGE_MODEL_WGSL = pageModelWgsl();
