// A PCG word hash of a seed as a unit float: its WGSL text, for the proofs that draw pseudo-random inputs
// (`tests/gpu/math/octahedral-fold.gpu.ts`), and its processor twin, the stream the golden salt's decorrelation is measured on
// (`mixWord.test.ts`).
import { wgslFn } from '../wgsl/decl.ts'

export const hashUnit = wgslFn(
  'hashUnit',
  [],
  `fn hashUnit(seed:u32)->f32{
 var x=seed*747796405u+2891336453u;
 x=((x>>((x>>28u)+4u))^x)*277803737u;
 x=(x>>22u)^x;
 return f32(x)*2.3283064e-10;
}`,
)

/** The PCG word hash of `seed` in wrapped 32-bit integers, then the word times 2^-32 in f32: every product wrapped, every shift
 *  unsigned, the last product rounded to f32 from f32 operands. */
export function cpuHashUnit(seed: number) {
  let x = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0
  x = ((x >>> 22) ^ x) >>> 0
  return Math.fround(Math.fround(x) * Math.fround(2.3283064e-10))
}
