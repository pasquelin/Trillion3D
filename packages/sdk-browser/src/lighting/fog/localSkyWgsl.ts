import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOCAL_FOG_SLOT } from './localLayout.ts'

/**
 * THE SKY LIGHT'S TERM IN THE LOCAL FOG VOLUMES, written once an image by the GPU into the block of the
 * light buffer (`localFogSky`, one thread): the sky light's diffuse light along a direction `n` of the
 * scene, for the first three harmonics (`skyLightDiffuseSimple`), is `max(0, a · n + b)` for each colour
 * channel — the harmonic's value is affine in the direction —, `a` its three coefficients turned into the
 * scene's frame (`sceneToCube`), `b` the constant. The row of channel `k` holds `(a, b)` times the
 * light's colour for that channel and its volumetric scattering intensity (`skyLightScattering`), so that
 * every program that lays the volumes over a point reads `max(0, row · (n, 1))` and needs none of the
 * light's own bindings. Nothing of a light that gives none: the colour is black, the rows zero. The
 * program declares the light buffer as its front (`AirBuffer`, `directLights`) and lists the sky light's
 * diffuse read (`skyLightDiffuseWgsl`).
 */
export const FOG_LOCAL_SKY_WGSL = wgslBlock(
  'FOG_LOCAL_SKY_WGSL',
  [],
  `
fn localSkyRow(k:u32)->vec4f{
 let h=skyHarmonic(k);
 return vec4f(h.x,h.z,-h.y,h.w)*(skyLight.colour[k]*skyLightScattering());
}
@compute @workgroup_size(1)
fn localSkyMain(){
 for(var k=0u;k<3u;k++){directLights.localFog[${LOCAL_FOG_SLOT.sky}u+k]=localSkyRow(k);}
}`,
)
