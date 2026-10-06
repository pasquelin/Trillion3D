import { shaderLanguage } from '../math/shaderLanguage.ts'
import { PI } from '../lighting/shaderConstants.ts'

/** Lanczos-2, `sinc(x)·sinc(x/2)` on `|x| < 2`: the kernel the current image is resampled with. */
export const LANCZOS2_WGSL = `
fn lanczos2(x:f32)->f32{
 if(x<1e-4){return 1.0;}
 if(x>=2.0){return 0.0;}
 var p:f32=${PI}*x;
 return 2.0*sin(p)*sin(0.5*p)/(p*p);
}`

/** The same kernel in GLSL, for WebGL2's spatial resample (`../webgl/core/resampleGlsl.ts`):
 *  `LANCZOS2_WGSL`'s own text through the shared translator (`shaderLanguage`). Here, not in the
 *  temporal upscale, so that WebGL2's resample holds none of the WebGPU passes (#1353). */
export const LANCZOS2_GLSL = shaderLanguage(LANCZOS2_WGSL, 'glsl')
