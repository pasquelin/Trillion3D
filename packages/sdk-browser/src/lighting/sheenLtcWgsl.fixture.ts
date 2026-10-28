import { wgslFn } from '../../../math/src/wgsl/decl.ts'
import { sheenLtcCoefficients } from './sheenLtcWgsl.ts'

/** The directional albedo of the sheen lobe at (`NoV`, `roughness`): the third channel of `sheenLtcCoefficients`. */
export const sheenLtcAlbedo = wgslFn(
  'sheenLtcAlbedo',
  [sheenLtcCoefficients],
  `fn sheenLtcAlbedo(NoV:f32,roughness:f32)->f32{
 return sheenLtcCoefficients(NoV,roughness).z;
}`,
)
