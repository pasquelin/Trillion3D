import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ATMOSPHERE_SLOT } from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import { IRRADIANCE_TERMS } from '../../../../sdk-core/src/scene/core/irradianceTerms.ts'
import { FOG_VOLUME_FLAG } from './frame.ts'

/**
 * THE SKY LIGHT'S LIGHT IN THE VOLUME (`fogSky`), read by the scatter (`lightsWgsl.ts`, which
 * multiplies it by the sky's visibility of the sample) and by the static term's pass
 * (`staticWgsl.ts`, which multiplies it by the visibility the volumetric lightmap stores). The
 * program declares the light buffer (`directLights`) and the frame (`frame`), and lists the fog's text
 * (`fogInscattering`) and the sky light's diffuse read (`skyLightDiffuseWgsl`).
 *
 * The light along `toEye` (the unit direction toward the eye) is the sky light's colour times its first
 * three harmonics in the direction `−g` times the direction to the eye (`skyLightDiffuseSimple`),
 * times the light's volumetric scattering intensity (`skyLightScattering`, zero without a sky light);
 * where the medium's light colours are overridden, the fog's inscattering colour times the ambient
 * harmonic, times the same intensity. The harmonics are read only where the frame says the sky light
 * lights the volume (`staticLight.z`: the light is not static, its lighting is on); the overridden
 * colours do not depend on it.
 */
export const FOG_SKY_LIGHT_WGSL = wgslBlock(
  'FOG_SKY_LIGHT_WGSL',
  [],
  `
const FOG_AMBIENT:f32=${IRRADIANCE_TERMS[0].basis};

/** The sky light's light along \`toEye\`: the sky's radiance, or the fog's own colours where they are
 *  asked for. */
fn fogSky(toEye:vec3f,span:f32)->vec3f{
 let share=skyLightScattering();
 if(share<=0.0){return vec3f(0.0);}
 if((u32(frame.medium.w)&${FOG_VOLUME_FLAG.fogColors}u)!=0u){
  return share*max(fogInscattering(-toEye*span,span,directLights.atmosphere[${ATMOSPHERE_SLOT.planet}].x!=0.0)*FOG_AMBIENT,vec3f(0.0));
 }
 if(frame.staticLight.z<=0.0){return vec3f(0.0);}
 return share*skyLightDiffuseSimple(toEye*frame.medium.x);
}`,
)
