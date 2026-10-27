import { lightStrengthWgsl } from '../direct/lightStrengthWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { hgPhase } from '../../../../math/src/wgsl/lighting.ts'
import { FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'
import { VOLUME_LAMP_WGSL } from '../direct/lampSeenWgsl.ts'
import { REACH } from '../direct/lightTermsWgsl.ts'
import { FOG_VOLUME_FLAG } from './frame.ts'
import { FOG_SKY_LIGHT_WGSL } from './skyLightWgsl.ts'
import { FOG_GI_WGSL } from './translucencyGiWgsl.ts'

/**
 * THE LIGHT A CELL OF THE VOLUME SCATTERS TOWARD THE EYE: what each light gives it at a point, by
 * the phase function — how the medium scatters toward the eye the light that goes through it.
 * The program declares the light buffer (`directLights`), the light lists (`tileLights`), the frame
 * (`frame`) and a shadow read (`shadowFactor`, `../direct/shadowWgsl.ts`), and lists the light
 * structures (`directLightWgsl`), `cellSlice` / `listedLight` (`TILE_SLICE_WGSL`) and `fogSkyVisibility` (`skyVisibilityWgsl.ts`).
 *
 * The phase function is Henyey and Greenstein's, of the cosine between the direction toward the
 * light and the direction toward the eye, and of the medium's distribution `g`: 0 equally every way,
 * toward 1 forward, toward −1 back. It sums to 1 over the sphere, so a light of illuminance `E`
 * gives a radiance `E · phase`.
 *
 * Three lights give light, each times its `fogScattering` (`params.z`; a light of none gives
 * nothing). The sun — the one directional light the volume holds, `frame.lighting.x` its rank, the
 * light store's held sun, the one the analytic fog's lobe follows — by its colour, its shadow
 * (where its `shadowsFog` is set) and the phase function; where the medium's light colours are
 * overridden, by the fog's own directional colour times the luminance of the sun's. The sky light,
 * by its harmonics' first three terms in the direction `−g` times the direction to the eye
 * (`skyLightDiffuseSimple`, times the light's colour), times its volumetric scattering intensity
 * (`skyLightScattering`; none where no sky light shines); where
 * the colours are overridden, by the fog's inscattering colour times the ambient harmonic, times
 * the same intensity (none where no sky light is); either times the sample's sky visibility (`fogSkyVisibility`, `skyVisibilityWgsl.ts`: the share of the sky
 * a cone straight up from the sample sees through the global distance field). Where the frame leaves the sky light to the
 * static term's pass (`staticLight.y`: stationary, casting shadows, a lightmap with a bent normal), this one adds none of it. Where the image made
 * a translucency volume (`fogGiShown`), its light along the camera vector (`fogGiLight`, `translucencyGiWgsl.ts`) takes the place of the sky
 * light's whole, the sky's visibility and the fog's colours with it. And the local lights of the cell's list of the
 * light grid (`gridCell`): a point, a spot or a lamp with a size by the inverse square of its
 * distance, or along its tube (`lampSeen`), the squared distance a cell's radius (scaled,
 * `frame.tune.w`) longer, so that no cell spikes near the light — a square centimetre at least,
 * `LAMP_BIAS` —, and the window of its range, the cone of a spot; a rectangle by its form factor
 * with no normal (`rectFormOf`). A local light whose `shadowsFog` is set and that holds a shadow
 * slot is shadowed by one sample of its map at the cell's point, as the sun is, while the setting
 * `volumetricFogLocalShadows` is on (`FOG_VOLUME_FLAG.localShadows`). The edge of a spot's
 * cone and of a rectangle's plane fade over a number of cells (`frame.blend.z`, none by default), so
 * that they flicker less. An orthographic view's rays are parallel: the eye's direction is the
 * view's own, its distance the one along the forward.
 */
export const FOG_LIGHTS_WGSL = wgslBlock(
  'FOG_LIGHTS_WGSL',
  [
    luminance,
    hgPhase,
    VOLUME_LAMP_WGSL,
    FOG_SKY_LIGHT_WGSL,
    FOG_GI_WGSL,
    lightStrengthWgsl('frame.exposure.w'),
  ],
  `
/** The sun's light at \`P\`: its colour, its shadow, the phase function. */
fn fogSun(P:vec3f,toEye:vec3f)->vec3f{
 if(frame.lighting.x<0.0){return vec3f(0.0);}
 let light=directLights.items[u32(frame.lighting.x)];
 var colour=light.colorIntensity.rgb*(lightStrength(light)*light.params.z)*lightFunctionOf(light.params.x,P);
 let fogLobe=directLights.fog[${FOG_SLOT.lobe}].rgb*directLights.fog[${FOG_SLOT.sun}].w;
 if((u32(frame.medium.w)&${FOG_VOLUME_FLAG.fogColors}u)!=0u&&directLights.fog[${FOG_SLOT.cubemap}].w<0.5&&dot(directLights.fog[${FOG_SLOT.sun}].xyz,directLights.fog[${FOG_SLOT.sun}].xyz)>0.0){
  colour=fogLobe*luminance(colour);
 }
 var shade=1.0;
 if(shadowsFog(light)){
  shade=shadowFactor(i32(light.params.y),light,P,vec3f(0.0),true);
  shade*=cloudShadowOnSurface(u32(frame.lighting.x),P);
 }
 if(shade<=0.0){return vec3f(0.0);}
 return colour*(shade*hgPhase(frame.medium.x,dot(-light.directionCone.xyz,toEye)));
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
 *  of its cone or of its plane fades (0 none): its colour times its share, its attenuation as a medium
 *  sees it (\`volumeLamp\`), faded at the cone's edge or in front of the plane, its shadow where it
 *  shadows the fog, and the phase function. */
fn fogLocal(rank:u32,P:vec3f,toEye:vec3f,biasSquared:f32,fade:f32)->vec3f{
${REACH('vec3f(0.0)')}
 if(isSun(light)||light.params.z<=0.0){return vec3f(0.0);}
 var seen=volumeLamp(light,P,biasSquared);
 if(fade>0.0){
  if(isRect(light)){seen.w*=saturate(dot(P-light.positionRange.xyz,light.directionCone.xyz)/fade);}
  else if(isSpot(light)){seen.w*=fogSpotFade(light,P,fade);}
 }
 if(seen.w>0.0&&shadowsFog(light)&&(u32(frame.medium.w)&${FOG_VOLUME_FLAG.localShadows}u)!=0u){seen.w*=shadowFactor(i32(light.params.y),light,P,vec3f(0.0),true);}
 return light.colorIntensity.rgb*lightFunctionFogLocalOf(light.params.x,P)*(lightStrength(light)*light.params.z)*(seen.w*hgPhase(frame.medium.x,dot(seen.xyz,toEye)));
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
 var light=fogSun(P,toEye);
 if(fogGiShown()){light+=fogGiLight(P,toEye);}
 else if(frame.staticLight.y<=0.0){
  let sky=fogSky(toEye,span);
  if(any(sky>vec3f(0.0))){light+=sky*fogSkyVisibility(P);}
 }
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
