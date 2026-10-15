/**
 * The current-frame filter's window: the four-term Blackman-Harris window over a radius of ONE
 * display pixel, evaluated where the resolve weighs its taps (`resolveWgsl.ts`) — no table, no
 * per-jitter weights written on the CPU.
 */
import { PI } from '../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'

/** The four-term Blackman-Harris coefficients. */
const BLACKMAN_HARRIS = [0.35875, 0.48829, 0.14128, 0.01168] as const

/** The window on `[0, 1)` of the radius, and zero from the radius on, where the window keeps six
 *  hundred-thousandths. One cosine: with `c = cos(πd)`, `cos(πd+π) = −c`, `cos 2x = 2c²−1` and
 *  `cos 3x = −(4c³−3c)`. */
export const BLACKMAN_HARRIS_WGSL = (() => {
  const [a0, a1, a2, a3] = BLACKMAN_HARRIS.map(wgslF32)
  return wgslBlock(
    'BLACKMAN_HARRIS_WGSL',
    [PI],
    `fn blackmanHarris(d:f32)->f32{
 if(d>=1.0){return 0.0;}
 let c=cos(d*PI);
 return ${a0}+${a1}*c+${a2}*(2.0*c*c-1.0)+${a3}*c*(4.0*c*c-3.0);
}`,
  )
})()
