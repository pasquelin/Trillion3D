// The shader's `hashUnit` (`../wgsl/sampling.ts`) on the processor, for the CPU runs of shaders that
// call it: the PCG word hash in wrapped 32-bit integers, then the word times 2^-32 in f32.

/** `hashUnit(seed)` as the GPU computes it: every product wrapped, every shift unsigned, the last
 *  product rounded to f32 from f32 operands. */
export function cpuHashUnit(seed: number) {
  let x = (Math.imul(seed >>> 0, 747796405) + 2891336453) >>> 0
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0
  x = ((x >>> 22) ^ x) >>> 0
  return Math.fround(Math.fround(x) * Math.fround(2.3283064e-10))
}
