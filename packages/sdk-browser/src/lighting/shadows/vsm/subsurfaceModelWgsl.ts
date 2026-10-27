/**
 * THE SUBSURFACE MODELS OF A PIXEL, as the shadow maps read them: a pixel of the thin transmission
 * (`SUBSURFACE_FLAG`: the subsurface and the two-sided foliage models) or of the subsurface profile,
 * the hair or the eye (`PIXEL_MODEL`), the subsurface shading models. The marking and the projection
 * cull none of its back-facing points; the thin transmission alone lets light through its shadow
 * (`vsmSubsurfaceShadow`), its opacity in the alpha of the thin transmission's target. The
 * preintegrated skin is neither: its diffusion keeps the shadow whole and its back faces culled, as
 * a lit surface's. A subsurface profile's transmission reads the shadow itself as its thickness, in
 * the lighting (`profileTransmission`, `../../direct/profileModelWgsl.ts`): the shadow keeps its
 * light whole for it.
 */
import { wgslFn } from '../../../../../math/src/wgsl/decl.ts'
import { SUBSURFACE_FLAG } from '../../../materials/surface/subsurface.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../../materials/surface/pixelModel.ts'

/** Whether a pixel of surface flags `flags` is of a subsurface model. */
export const vsmSubsurfaceModel = wgslFn(
  'vsmSubsurfaceModel',
  [pixelModelOf],
  `fn vsmSubsurfaceModel(flags:u32)->bool{
 let model=pixelModelOf(flags);
 return (flags&${SUBSURFACE_FLAG}u)!=0u||model==${PIXEL_MODEL.profile}u||model==${PIXEL_MODEL.hair}u||model==${PIXEL_MODEL.eye}u;
}`,
)

/** Whether a pixel of surface flags `flags` lets light through its shadow: the thin transmission. */
export const vsmTransmitsShadow = wgslFn(
  'vsmTransmitsShadow',
  [],
  `fn vsmTransmitsShadow(flags:u32)->bool{
 return (flags&${SUBSURFACE_FLAG}u)!=0u;
}`,
)
