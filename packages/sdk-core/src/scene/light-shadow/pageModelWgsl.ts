import { pageModel } from './pageModel.ts';
import type { PageOps } from './pageOps.ts';
import { LAMP_MIPS, LAMP_SIDE, SUN_LEVELS, SUN_WINDOW } from './virtual.ts';
import { PAGE_MODEL_FUNCTIONS, SIGNATURES } from './pageModelSignatures.ts';

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
