import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { hgPhase } from '../../../../math/src/wgsl/lighting.ts'
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { IRRADIANCE_TERMS } from '../../../../sdk-core/src/scene/core/irradianceTerms.ts'
import { SKY_SLOT } from '../../../../sdk-core/src/scene/core/environmentSky.ts'
import { FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'
import { LAMP_WGSL } from '../direct/lampSeenWgsl.ts'
import { REACH } from '../direct/lightTermsWgsl.ts'
import { FOG_VOLUME_FLAG } from './frame.ts'

/** The sky light's irradiance, the constant and linear bands (`irradianceShader`): the first four
 *  terms of the basis. */
const SKY_BANDS = 4

/**
 * THE LIGHT A CELL OF THE VOLUME SCATTERS TOWARD THE EYE: what each light gives it at a point, by
 * the phase function — how the medium scatters toward the eye the light that goes through it.
 * The program declares the light buffer (`directLights`), the light lists (`tileLights`), the frame
 * (`frame`) and a shadow read (`shadowFactor`, `../direct/shadowWgsl.ts`), and lists the light
 * structures (`directLightWgsl`) and `cellSlice` / `listedLight` (`TILE_SLICE_WGSL`).
 *
 * The phase function is Henyey and Greenstein's, of the cosine between the direction toward the
 * light and the direction toward the eye, and of the medium's distribution `g`: 0 equally every way,
 * toward 1 forward, toward −1 back. It sums to 1 over the sphere, so a light of illuminance `E`
 * gives a radiance `E · phase`.
 *
 * Three lights give light. The sun — the one directional light the volume holds, `frame.lighting.x`
 * its rank, the light store's held sun, the one the analytic fog's lobe follows — by its colour, its shadow and the phase function; where
 * the medium's light colours are overridden, by the fog's own directional colour times the luminance
 * of the sun's. The sky light, by its irradiance's first two bands in the direction `−g` times the
 * direction to the eye, over π: a radiance, which for an isotropic sky is its own; where the colours
 * are overridden, by the fog's inscattering colour times the ambient harmonic. And the local lights
 * of the cell's list of the light grid (`gridCell`): a point, a spot or a lamp with a size by the
 * inverse square of its distance, or along its tube (`lampSeen`), the squared distance a cell's radius
 * (scaled, `frame.tune.w`) longer, so that no cell spikes near the light — a square centimetre at
 * least, `LAMP_BIAS` —, and the window of its range, the cone of a spot; a rectangle by its form
 * factor with no normal (`rectFormOf`). The sun's shadow darkens the volume; a lamp casts none there,
 * as the reference's lamps do by default. The edge
 * of a spot's cone and of a rectangle's plane fade over a number of cells (`frame.blend.z`, none by
 * default), so that they flicker less. The sky light scatters only where the scene has one.
 */
export const FOG_LIGHTS_WGSL = wgslBlock(
  'FOG_LIGHTS_WGSL',
  [PI, luminance, hgPhase, LAMP_WGSL],
  `
const FOG_AMBIENT:f32=${IRRADIANCE_TERMS[0].basis};

/** The sky light's radiance along the direction \`n\`: its irradiance's constant and linear bands, over π. */
fn fogSkyRadiance(n:vec3f)->vec3f{
 let s=directLights.sky;
 return max((${irradianceShader((k) => `s[${SKY_SLOT.irradiance + k}].rgb`, 'n', SKY_BANDS)})/PI,vec3f(0.0));
}
/** The sun's light at \`P\`: its colour, its shadow — a directional light casts one into the volume —,
 *  the phase function. */
fn fogSun(P:vec3f,toEye:vec3f)->vec3f{
 if(frame.lighting.x<0.0){return vec3f(0.0);}
 let light=directLights.items[u32(frame.lighting.x)];
 var colour=light.colorIntensity.rgb*light.colorIntensity.w;
 let fogLobe=directLights.fog[${FOG_SLOT.lobe}].rgb*directLights.fog[${FOG_SLOT.sun}].w;
 if((u32(frame.medium.w)&${FOG_VOLUME_FLAG.fogColors}u)!=0u&&directLights.fog[${FOG_SLOT.cubemap}].w<0.5&&dot(directLights.fog[${FOG_SLOT.sun}].xyz,directLights.fog[${FOG_SLOT.sun}].xyz)>0.0){
  colour=fogLobe*luminance(colour);
 }
 let shade=shadowFactor(i32(light.params.y),light,P,vec3f(0.0),true);
 if(shade<=0.0){return vec3f(0.0);}
 return colour*(shade*hgPhase(frame.medium.x,dot(-light.directionCone.xyz,toEye)));
}
/** The sky light's light along \`toEye\` (the unit direction toward the eye): the sky's radiance, or the fog's
 *  own colours where they are asked for; none where the scene has no sky light. */
fn fogSky(toEye:vec3f,span:f32)->vec3f{
 if(directLights.sky[${SKY_SLOT.upper}].w<0.5){return vec3f(0.0);}
 let g=frame.medium.x;
 if((u32(frame.medium.w)&${FOG_VOLUME_FLAG.fogColors}u)!=0u){
  return max(fogInscattering(-toEye*span,span,fogSkyShown())*FOG_AMBIENT,vec3f(0.0));
 }
 return fogSkyRadiance(toEye*g);
}
/** How much of a spot's light a point keeps near the edge of its cone, over \`fade\` metres: the distance
 *  of the point inside the cone, over the fade; none for a cone as wide as a half space. */
fn fogSpotFade(light:DirectLight,P:vec3f,fade:f32)->f32{
 let cosine=light.directionCone.w;
 if(cosine<=0.0){return 1.0;}
 let offset=P-light.positionRange.xyz;
 let along=dot(light.directionCone.xyz,offset);
 let across=length(offset-light.directionCone.xyz*along);
 return saturate((along*sqrt(1.0-cosine*cosine)/cosine-across)/fade);
}
/** One local light's light at \`P\`, \`biasSquared\` the squared distance its inverse square is taken
 *  at longer than the real one, in the way of the cell's size, \`fade\` the distance over which the edge
 *  of its cone or of its plane fades (0 none): its colour times its attenuation, its share in the volume
 *  and the phase function. A rectangle is its form factor with no normal (\`rectFormOf\`), faded in front
 *  of its plane; any other lamp — a point, a spot, one with a size — is the falloff the lamp's own term
 *  gives (\`lampSeen\`) over that longer distance, its cosine, which a medium has no surface for, unread.
 *  A lamp casts no shadow into the volume (the reference's default for any light but a directional one). */
fn fogLocal(rank:u32,P:vec3f,toEye:vec3f,biasSquared:f32,fade:f32)->vec3f{
${REACH('vec3f(0.0)')}
 if(isSun(light)){return vec3f(0.0);}
 var attenuation=0.0;
 var toward=vec3f(0.0);
 if(isRect(light)){
  let r=rectView(light,P);
  attenuation=rectFormOf(r)*r.window;
  if(fade>0.0){attenuation*=saturate(dot(P-light.positionRange.xyz,light.directionCone.xyz)/fade);}
  toward=normalize(light.positionRange.xyz-P);
 }else{
  let incidence=directIncidence(light,P);
  attenuation=lampSeen(light,P,vec3f(0.0),incidence,biasSquared).falloff;
  if(fade>0.0&&isSpot(light)){attenuation*=fogSpotFade(light,P,fade);}
  toward=incidence.xyz;
 }
 return light.colorIntensity.rgb*light.colorIntensity.w*(attenuation*hgPhase(frame.medium.x,dot(toward,toEye)));
}
/** The light of every light at the sample of a cell at \`offset\` within it: the sun, the sky light and
 *  the local lights of the cell's list, each taken at the distance its inverse square is read at
 *  (\`fogLocal\`), the cell's radius scaled, where the list holds one. */
fn fogLightAt(cell:vec3u,offset:vec3f)->vec3f{
 let P=fogCellPoint(cell,offset).xyz;
 let toEyeFull=frame.eye.xyz-P;
 var span=max(sqrt(dot(toEyeFull,toEyeFull)),1e-6);
 var toEye=toEyeFull/span;
 if(fogOrtho()){
  // Parallel rays: the eye's direction is the view's own, its distance the one along the forward.
  span=max(span*span/max(dot(-toEyeFull,frame.forward.xyz),1e-6),1e-6);
  toEye=-frame.forward.xyz;
 }
 var light=fogSun(P,toEye)+fogSky(toEye,span);
 let clip=frame.viewProj*vec4f(P,1.0);
 let slice=cellSlice(gridCell((vec2f(cell.xy)+0.5)*frame.grid.w,clip.z/clip.w,vec2u(frame.lighting.yz)));
 if(slice.y>0u){
  let radius=max(length(P-fogCellPoint(cell+vec3u(1u),offset).xyz)*frame.tune.w,sqrt(LAMP_BIAS));
  let biasSquared=radius*radius;
  // The edge fade is a number of cells of the flat grid: the distance to the cell's far corner on its slice.
  let fade=select(0.0,length(P-fogCellPoint(cell+vec3u(1u,1u,0u),offset).xyz)*frame.blend.z,frame.blend.z>0.0);
  for(var index=0u;index<slice.y;index++){light+=fogLocal(listedLight(slice,index),P,toEye,biasSquared,fade);}
 }
 return light;
}`,
)
