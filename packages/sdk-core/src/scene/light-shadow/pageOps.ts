/**
 * The operations the page model is written over (`pageModel.ts`): evaluated on numbers they are
 * the scheduler's arithmetic, printed as WGSL the shaders' (`pageModelWgsl.ts`).
 */
export interface PageOps<V> {
  int(n: number): V;
  float(n: number): V;
  add(a: V, b: V): V;
  sub(a: V, b: V): V;
  neg(a: V): V;
  mul(a: V, b: V): V;
  /** Of floats, or of integers that divide exactly. */
  div(a: V, b: V): V;
  mod(a: V, b: V): V;
  shr(a: V, b: V): V;
  max(a: V, b: V): V;
  min(a: V, b: V): V;
  clamp(a: V, low: V, high: V): V;
  floor(a: V): V;
  log2(a: V): V;
  exp2(a: V): V;
  asin(a: V): V;
  toInt(a: V): V;
  toFloat(a: V): V;
  lt(a: V, b: V): V;
  ge(a: V, b: V): V;
  or(a: V, b: V): V;
  pick(when: V, yes: V, no: V): V;
}

/** The operations on numbers: what the scheduler computes. */
export const NUMBERS: PageOps<number> = {
  int: (n) => n,
  float: (n) => n,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  neg: (a) => -a,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  mod: (a, b) => a % b,
  shr: (a, b) => a >> b,
  max: (a, b) => Math.max(a, b),
  min: (a, b) => Math.min(a, b),
  clamp: (a, low, high) => Math.min(Math.max(a, low), high),
  floor: Math.floor,
  log2: Math.log2,
  exp2: (a) => 2 ** a,
  asin: Math.asin,
  toInt: Math.trunc,
  toFloat: (a) => a,
  lt: (a, b) => +(a < b),
  ge: (a, b) => +(a >= b),
  or: (a, b) => +(a || b),
  pick: (when, yes, no) => (when ? yes : no),
};
