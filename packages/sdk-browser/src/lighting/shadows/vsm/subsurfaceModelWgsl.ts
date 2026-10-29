/**
 * THE SUBSURFACE MODELS OF A PIXEL, as the shadow maps read them (`isSubsurfaceModel`: the thin
 * transmission and the subsurface, skin, profile, hair and eye models). Light enters these surfaces and
 * leaves them elsewhere, so a back face of one is still lit from the light's side: the marking and the
 * projection cull none of its back-facing points. The thin transmission alone lets light through its shadow
 * (`vsmTransmitsShadow`), its opacity in the alpha of the thin transmission's target. A subsurface
 * profile's transmission reads the shadow itself as its thickness, in the lighting
 * (`profileTransmission`, `../../direct/profileModelWgsl.ts`): the shadow keeps its light whole for it.
 */
import { wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { SUBSURFACE_FLAG, isSubsurfaceModel } from '../../../materials/surface/subsurface.ts'

/** Whether a pixel of surface flags `flags` is of a subsurface model (`isSubsurfaceModel`). */
export const vsmSubsurfaceModel = wgslFn(
  'vsmSubsurfaceModel',
  [isSubsurfaceModel],
  'fn vsmSubsurfaceModel(flags:u32)->bool{return isSubsurfaceModel(flags);}',
)

/** Whether a pixel of surface flags `flags` lets light through its shadow: the thin transmission. */
export const vsmTransmitsShadow = wgslFn(
  'vsmTransmitsShadow',
  [],
  `fn vsmTransmitsShadow(flags:u32)->bool{
 return (flags&${SUBSURFACE_FLAG}u)!=0u;
}`,
)
