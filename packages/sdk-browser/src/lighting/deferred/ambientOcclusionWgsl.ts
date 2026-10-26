import { DIVISOR_FLOOR } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { VIEW_WGSL } from './worldAtWgsl.ts'

/**
 * WHAT THE OPAQUE RESOLVE DOES WITH THE AMBIENT OCCLUSION the image drew (`../ao/frame.ts`): a texture of one byte a
 * pixel, read by load, and the view's two words that say how it applies (`views.y`, the mode; `views.z`, the share).
 * `ambientOcclusionApplied` answers the four factors the lighting multiplies by, from the pixel's material occlusion:
 *  - `emission`, on what the base pass left in the picture — a surface's emission: the material's occlusion and the
 *    image's, taken at the share `views.z` (the static fraction) between none and all of both;
 *  - `sky`, the occlusion the sky light's diffuse and the environment's go under, and, in a program that reads the
 *    screen probes, the sky light's diffuse they leave unread: the smaller of
 *    the material's and the image's;
 *  - `bounce`, on the light the screen probes gathered: the image's occlusion taken at the share `views.z` (the
 *    probes' own occlusion's strength);
 *  - `both`, the material's occlusion and the image's together, which the environment's specular goes under
 *    (`AMBIENT_SPECULAR_OCCLUSION_WGSL`) in every mode that draws one: the image's alone is the material's.
 * Mode 0 — no occlusion drawn, or none to apply — answers 1, the material's own, 1 and the material's: the pixel is
 * lit as it was before the occlusion existed, bit for bit but for a surface whose material occludes its reflection.
 */
export const AMBIENT_OCCLUSION_READ_WGSL = wgslBlock(
  'AMBIENT_OCCLUSION_READ_WGSL',
  [VIEW_WGSL],
  `@group(0) @binding(${DEFERRED_BINDINGS.ambientOcclusion}) var ambientOcclusion:texture_2d<f32>;
struct OccludedTerms{emission:f32,sky:f32,bounce:f32,both:f32,}
fn ambientOcclusionApplied(coord:vec2i,materialAo:f32)->OccludedTerms{
 let mode=u32(view.views.y);
 if(mode==0u){return OccludedTerms(1.0,materialAo,1.0,materialAo);}
 let seen=textureLoad(ambientOcclusion,coord,0).r;
 let both=materialAo*seen;
 if(mode==1u){return OccludedTerms(mix(1.0,both,view.views.z),min(materialAo,seen),1.0,both);}
 return OccludedTerms(1.0,materialAo,mix(1.0,seen,view.views.z),both);
}`,
)

/**
 * What the occlusion leaves of the environment's reflection that no ray answered (`ambientSpecularOcclusion`): the
 * occlusion `occluded` (`OccludedTerms.both`) taken through the view angle and the roughness,
 * `saturate(pow(N·V + AO, roughness²) − 1 + AO)`; 1 where nothing occludes. The floor keeps `pow` off a zero base.
 * The reflection's composition multiplies the share the field answers by it.
 */
export const AMBIENT_SPECULAR_OCCLUSION_WGSL = wgslBlock(
  'AMBIENT_SPECULAR_OCCLUSION_WGSL',
  [DIVISOR_FLOOR],
  `fn ambientSpecularOcclusion(occluded:f32,N:vec3f,V:vec3f,rough:f32)->f32{
 return saturate(pow(max(saturate(dot(N,V))+occluded,DIVISOR_FLOOR),rough*rough)-1.0+occluded);
}`,
)

/** The statements that apply it in the body of the colour pass and of the indirect pass, which apply it to the emission and to the indirect light:
 *  `occlusion` names the three factors. */
export const AMBIENT_OCCLUSION_STATEMENT =
  'let occlusion=ambientOcclusionApplied(coord,emissive.a);'
