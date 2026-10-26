import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { MODEL_SWITCH } from '../../materials/surface/pixelModel.ts'

/**
 * WHAT THE LIGHTING CALLS FOR A SUBSURFACE-PROFILE PIXEL, so that the lit image holds what the scattering reads of it
 * (`SSS_LIT_WGSL`; the lighting's own hooks live with the shading models):
 * - which of the lighting's passes the pixel gets it in (`sssLitPostprocess`, `sssLitCheckerboard`: the switches `MODEL_SWITCH` of the view, `subsurfaceScattering` and `subsurfaceCheckerboard`);
 * - while the pass runs (`postprocess`), the base colour the lighting multiplies by is one, the surface's own colour being multiplied
 *   back after the scattering; in a checkerboard (`checkerboard`) the pixel's lighting is the diffuse light on the pixels of the
 *   phase (`sssLitChecker`) and the specular light, weighed by the specular share, on the others: the base colour is the phase, the
 *   specular scaled by its complement (`sssLitBase`, `sssLitSpecular`);
 * - the light accumulated for the image's alpha is the luminance of the diffuse light a light adds (`scatterAdd`, summed by the
 *   lighting over the lights), and the lit colour's alpha the sum where neither the checkerboard nor a pass that does not run
 *   take it away (`sssLitResult`).
 * The data the shade pass leaves in the per-model target is the profile in `x` and the opacity — the share of the profile's radius the
 * pixel scatters over — in `w` (`y` and `z` stay the model's).
 */
export const SSS_LIT_WGSL = wgslBlock(
  'SSS_LIT_WGSL',
  [],
  `fn sssLitPostprocess(bits:u32)->bool{return (bits&${MODEL_SWITCH.subsurfaceScattering}u)!=0u;}
fn sssLitCheckerboard(bits:u32)->bool{return (bits&${MODEL_SWITCH.subsurfaceCheckerboard}u)!=0u;}
fn sssLitChecker(pixel:vec2u,phase:u32)->bool{return ((pixel.x+pixel.y+phase)%2u)!=0u;}
fn sssLitBase(base:vec3f,checker:bool,postprocess:bool,checkerboard:bool)->vec3f{
 var b=select(base,vec3f(1.0),postprocess);
 if(postprocess&&checkerboard){b=vec3f(select(0.0,1.0,checker));}
 return b;
}
fn sssLitSpecular(specular:f32,checker:bool,postprocess:bool,checkerboard:bool)->f32{
 return select(specular,specular*select(1.0,0.0,checker),postprocess&&checkerboard);
}
fn sssLitResult(total:vec3f,scatterableLuma:f32,postprocess:bool,checkerboard:bool)->vec4f{
 return vec4f(total,select(0.0,scatterableLuma,postprocess&&!checkerboard));
}`,
)
