import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { VIEW_WGSL } from './worldAtWgsl.ts'

/**
 * WHAT THE OPAQUE RESOLVE DOES WITH THE AMBIENT OCCLUSION the image drew (`../ao/frame.ts`): a texture of one byte a
 * pixel, read by load, and the view's two words that say how it applies (`views.y`, the mode; `views.z`, the share).
 * `ambientOcclusionApplied` answers the three factors the lighting multiplies by, from the pixel's material occlusion:
 *  - `emission`, on what the base pass left in the picture — a surface's emission: the material's occlusion and the
 *    image's, taken at the share `views.z` (the static fraction) between none and all of both;
 *  - `sky`, the occlusion the sky light's diffuse and the environment's go under, and, in a program that reads the
 *    world's probes — which carry the sky with the bounce, the two not told apart —, the probes' diffuse: the smaller of
 *    the material's and the image's;
 *  - `bounce`, on the light the screen probes gathered: the image's occlusion taken at the share `views.z` (the
 *    probes' own occlusion's strength).
 * Mode 0 — no occlusion drawn, or none to apply — answers 1, the material's own and 1: the pixel is lit as it was
 * before the occlusion existed, bit for bit.
 */
export const AMBIENT_OCCLUSION_READ_WGSL = wgslBlock(
  'AMBIENT_OCCLUSION_READ_WGSL',
  [VIEW_WGSL],
  `@group(0) @binding(${DEFERRED_BINDINGS.ambientOcclusion}) var ambientOcclusion:texture_2d<f32>;
struct OccludedTerms{emission:f32,sky:f32,bounce:f32,}
fn ambientOcclusionApplied(coord:vec2i,materialAo:f32)->OccludedTerms{
 let mode=u32(view.views.y);
 if(mode==0u){return OccludedTerms(1.0,materialAo,1.0);}
 let seen=textureLoad(ambientOcclusion,coord,0).r;
 if(mode==1u){return OccludedTerms(mix(1.0,materialAo*seen,view.views.z),min(materialAo,seen),1.0);}
 return OccludedTerms(1.0,materialAo,mix(1.0,seen,view.views.z));
}`,
)

/** The statements that apply it in the body of the resolve, after the lights are summed and the indirect light read:
 *  `occlusion` names the three factors. */
export const AMBIENT_OCCLUSION_STATEMENT =
  'let occlusion=ambientOcclusionApplied(coord,emissive.a);'
