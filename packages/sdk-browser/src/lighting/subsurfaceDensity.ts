import { wgslFn } from '../../../math/src/wgsl/decl.ts'

/** The scale of the density a subsurface material's opacity gives, per centimetre. */
const DENSITY_SCALE = 0.05
/** The opacity the density holds to: 1 would be a density of infinity. */
const OPACITY_CAP = 0.99

/** The density, per centimetre, of the light a material of `opacity` lets through: `0.05` times the log of
 *  the share it does not stop, the opacity held to 0.99; a declaration the shaders list (`contactShadowWgsl`,
 *  the virtual shadow maps' projection, the sun's distance-field shadow's trace). */
export const subsurfaceDensity = wgslFn(
  'subsurfaceDensity',
  [],
  `fn subsurfaceDensity(opacity:f32)->f32{return -${DENSITY_SCALE}*log(1.0-min(opacity,${OPACITY_CAP}));}`,
)
