import { pageModel, type PageModel } from './pageModel.ts';
import type { PageOps } from './pageOps.ts';
import { LAMP_MIPS, LAMP_SIDE, SUN_LEVELS, SUN_WINDOW } from './virtual.ts';

/** A literal, parenthesised when negative. */
const literal = (text: string) => (text.startsWith('-') ? `(${text})` : text);

/** The page model's operations printed as WGSL: integers are `i32`, floats `f32`. */
const WGSL: PageOps<string> = {
  int: (n) => literal(String(n)),
  float: (n) => literal(Number.isInteger(n) ? `${n}.0` : String(n)),
  add: (a, b) => `(${a}+${b})`,
  sub: (a, b) => `(${a}-${b})`,
  mul: (a, b) => `(${a}*${b})`,
  div: (a, b) => `(${a}/${b})`,
  mod: (a, b) => `(${a}%${b})`,
  // An `i32` shifted by a `u32`, whatever literal it starts from.
  shr: (a, b) => `(i32(${a})>>u32(${b}))`,
  max: (a, b) => `max(${a},${b})`,
  clamp: (a, low, high) => `clamp(${a},${low},${high})`,
  floor: (a) => `floor(${a})`,
  log2: (a) => `log2(${a})`,
  exp2: (a) => `exp2(${a})`,
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
  shadowPcfStep: ['t:f32', 'first:f32', 'i32'],
};

/** The WGSL names of the page model's functions: what a test running the shaders in Node lists. */
export const PAGE_MODEL_FUNCTIONS = Object.keys(SIGNATURES) as Array<keyof PageModel<string>>;

const printed = pageModel(WGSL) as unknown as Record<string, (...names: string[]) => string>;

/**
 * The page model as the shaders compile it (`pageModel.ts`): the layout constants they index
 * with, then one function per formula, each the printed formula the scheduler evaluates.
 */
export const PAGE_MODEL_WGSL = `
const SUN_LEVEL_COUNT:i32=${SUN_LEVELS};
const SUN_WINDOW_PAGES:i32=${SUN_WINDOW};
const LAMP_PAGE_COUNT:u32=${LAMP_SIDE}u;
const LAMP_MIP_COUNT:u32=${LAMP_MIPS}u;
${PAGE_MODEL_FUNCTIONS.map((name) => {
  const signature = SIGNATURES[name],
    params = signature.slice(0, -1);
  const body = printed[name](...params.map((param) => param.split(':')[0]));
  return `fn ${name}(${params.join(',')})->${signature[signature.length - 1]}{return ${body};}`;
}).join('\n')}`;
