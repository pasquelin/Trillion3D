/**
 * The current-frame filter's window: the four-term Blackman-Harris window over a radius of one
 * footprint, written as a polynomial of the SQUARED distance — no square root, no cosine a tap —,
 * the degree-7 least-squares fit on [0, 1) (within 6e-5 of the window, which keeps six
 * hundred-thousandths at its radius), zero from the radius on and never below zero. Evaluated where
 * the resolve weighs its taps (`resolveWgsl.ts`); the coefficients are its one home, which the CPU
 * models read too.
 */
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'

/** The window's coefficients in the squared distance, constant term first. */
export const TAA_WINDOW = [
  0.999985973, -5.71516604, 14.9518474, -23.7064542, 24.9772219, -17.4896056, 7.40923141,
  -1.42706114,
] as const

/** The window at squared distance `d2` (in footprints): Horner's rule, as the shader runs it. */
export function taaWindow(d2: number) {
  if (d2 >= 1) return 0
  let v = 0
  for (let k = TAA_WINDOW.length - 1; k >= 0; k--) v = v * d2 + TAA_WINDOW[k]
  return Math.max(v, 0)
}

export const TAA_WINDOW_WGSL = wgslBlock(
  'TAA_WINDOW_WGSL',
  [],
  `fn taaWindow(d2:f32)->f32{
 if(d2>=1.0){return 0.0;}
 var v=${wgslF32(TAA_WINDOW[TAA_WINDOW.length - 1])};
${TAA_WINDOW.slice(0, -1)
  .map((c) => ` v=v*d2+${wgslF32(c)};`)
  .reverse()
  .join('\n')}
 return max(v,0.0);
}`,
)
