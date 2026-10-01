import { MODEL_FLAG } from '../../scene/surfaceModel.ts';
import { INVERSE_PI } from '../shaderConstants.ts';

/**
 * The contribution of one declared light at the point, its shadow included — the engine's only
 * lighting formula. A light out of range, or fully in shadow, yields exactly zero.
 *
 * Without `shadowed` (#1249), the program of a scene no light of which holds a shadow slot: every
 * light's `shadowFactor` answers exactly one and a transmission of exactly one, so the same terms
 * without them are the same product, bit for bit (`tests/browser/probes/narrow-resolve-gpu.ts`),
 * with none of the shadow code compiled in. That code costs an unshadowed light 40 % of its
 * evaluation although it runs none of it — the registers it holds lower the pixels in flight —,
 * timed on the resolve of 64 lamps; the program is chosen per frame (`contractVariants.ts`).
 *
 * Without `rects` (#1369), the program of a scene that holds no rectangle light: \`isRect\` answers
 * false for every light, so the branch it guards never runs and its absence changes no term. The
 * rectangle's shading — its clipped polygon and fitted lobe (\`rectLightWgsl.ts\`) — is the largest
 * code of the loop: left out, every punctual light of the loop runs without the registers it holds.
 */
export const declaredLightWgsl = (shadowed: boolean, rects = true) => `
fn declaredLight(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->vec3f{${rects ? RECT_BRANCH_WGSL : ''}
 let incidence=directIncidence(light,P);
 if(incidence.w<=0.0){return vec3f(0.0);}${shadowed ? SHADE_WGSL : ''}
 let energy=light.colorIntensity.w*incidence.w${shadowed ? '*shade' : ''};
 let color=light.colorIntensity.rgb${shadowed ? '*shadowTransmission' : ''};
 let transmitted=thinSubsurface*thinTransmission(dot(N,normalize(incidence.xyz)),energy);
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return (modelLight(rgb,metal,N,incidence.xyz,energy,ao)+transmitted)*color;}
 return (standardLighting(rgb,metal,rough,N,V,vec4f(incidence.xyz,energy))+transmitted)*color;
}`;

/** A rectangle light's term, before any punctual one's: \`declaredLight\` with \`rects\`. */
const RECT_BRANCH_WGSL = `
 if(isRect(light)){
  var transmitted=vec3f(0.0);
  if(any(thinSubsurface>vec3f(0.0))){transmitted=thinSubsurface*rectIrradiance(light,P,-N).w*${INVERSE_PI}*light.colorIntensity.rgb*light.colorIntensity.w;}
  return rectLight(light,rgb,metal,rough,N,V,P,ao)+transmitted;
 }`;

const SHADE_WGSL = `
 // A surface facing away from the light gets its exact zero whatever the shadow: the filter's
 // taps are skipped, never the page reads and requests (\`shadowPcf\`). Toon bands light it.
 let back=any(thinSubsurface>vec3f(0.0))&&dot(N,incidence.xyz)<0.0;
 let facing=back||surfaceModel==${MODEL_FLAG.toon}u||select(dot(N,normalize(incidence.xyz)),dot(N,incidence.xyz),surfaceModel==${MODEL_FLAG.diffuse}u)>0.0;
 let shade=shadowFactor(i32(light.params.y),light,P+shadowReceiverOffset,shadowBiasNormal(select(N,-N,back),shadowReceiverPlane),incidence.xyz,facing);
 if(shade<=0.0){return vec3f(0.0);}`;

/**
 * The one loop that shades a pixel's lights in full: the lights of a cell's list (`cellSlice`) — or,
 * from `TILE_NO_SLICE`, every light of the scene — in increasing rank.
 *
 * With `reject` — the program with no shadow code (#1249) — a light is first rejected on its
 * sphere alone, before its record is read in full, where it lies past its range by a
 * ten-thousandth of its squared range (`RANGE_REJECT`): there `directIncidence` would have returned
 * zero before any shading, so the sum loses an exact zero only. The kind is read alone
 * (`isSunKind`), not through `isSun`, which takes the whole record. Timed on the resolve (64
 * lamps, a million pixels), it takes 30 % off a light out of range for 13 % on one in range: in
 * the program with shadow code that 13 % is not repaid (42.3 → 47.9 ps a light in range), so that
 * program keeps develop's loop, the reject left out, and costs a light what develop's does.
 */
export const sliceLightingWgsl = (reject: boolean) => `
fn sliceLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->vec3f{
 var result=vec3f(0.0);
 for(var index=0u;index<slice.y;index++){
  var light=index;if(slice.x!=TILE_NO_SLICE){light=tileLights[slice.x+index];}${reject ? RANGE_REJECT_WGSL : ''}
  result+=declaredLight(directLights.items[light],rgb,metal,rough,N,V,P,ao);
 }
 return result;
}`;

const RANGE_REJECT_WGSL = `
  let sphere=directLights.items[light].positionRange;
  let offset=sphere.xyz-P;
  if(!isSunKind(directLights.items[light].params.x)&&dot(offset,offset)>sphere.w*sphere.w*RANGE_REJECT){continue;}`;
