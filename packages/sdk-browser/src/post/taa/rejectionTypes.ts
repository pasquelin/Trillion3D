import { HALF_MAX } from '../../../../math/src/constants.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import type { Precision } from './colorSpaceWgsl.ts'

/** The reciprocal helper of a precision (`safeRcp`, with its suffix). */
export const rcpOf = ({ S }: Precision) => (S ? `safeRcp${S}` : 'safeRcp')

/** The names a precision gives the rejection's stages, and the conversions its types ask: `rcp` the
 *  reciprocal, `cast(T, e)` the expression `e` as type `T` where the precision is not 32 bits' (a
 *  conversion to or from it), `bounded(e)` a 32-bit bound `e` the 16-bit precision holds within its
 *  largest finite. */
export interface RejectionTypes extends Precision {
  readonly rcp: string
  readonly cast: (T: string, e: string) => string
  readonly bounded: (e: string) => string
}
export const rejectionTypes = (p: Precision): RejectionTypes => ({
  ...p,
  rcp: rcpOf(p),
  cast: (T, e) => (p.S ? `${T}(${e})` : e),
  bounded: (e) => (p.S ? `${p.F}(min(${e},${wgslF32(HALF_MAX)}))` : e),
})
