import { MODEL_FLAG } from '../../scene/surfaceModel.ts'
import { INVERSE_PI } from '../shaderConstants.ts'

/**
 * The contribution of one declared light at the point, its shadow included — the engine's only
 * lighting formula. A light out of range, or fully in shadow, yields exactly zero.
 *
 * Without `shadowed` (#1249), the program of a scene no light of which holds a shadow slot: every
 * light's `shadowFactor` answers exactly one and a transmission of exactly one, so the same terms
 * without them are the same product, bit for bit (`tests/gpu/lighting/narrow-resolve.gpu.ts`),
 * with none of the shadow code compiled in. That code costs an unshadowed light 40 % of its
 * evaluation although it runs none of it — the registers it holds lower the pixels in flight —,
 * timed on the resolve of 64 lamps; the program is chosen per frame (`contractVariants.ts`).
 *
 * Without `rects` (#1369), the program of a scene that holds no rectangle light: \`isRect\` answers
 * false for every light, so the branch it guards never runs and its absence changes no term. The
 * rectangle's shading — its clipped polygon and fitted lobe (\`rectLightWgsl.ts\`) — is the largest
 * code of the loop: left out, every punctual light of the loop runs without the registers it holds.
 */
export const declaredLightWgsl = (
  shadowed: boolean,
  rects = true,
  pair = false,
) => `${pair ? LIGHT_PAIR_WGSL : ''}
fn declaredLight${pair ? 'Pair' : ''}(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32)->${pair ? 'LightPair' : 'vec3f'}{${rects ? rectBranchWgsl(pair) : ''}
 let incidence=directIncidence(light,P);
 if(incidence.w<=0.0){return ${zero(pair)};}${shadowed ? shadeWgsl(pair) : ''}
 let energy=light.colorIntensity.w*incidence.w${shadowed ? '*shade' : ''};
 let color=light.colorIntensity.rgb${shadowed ? '*shadowTransmission' : ''};
 // A surface with no thin transmission adds an exact zero: 0·x is ±0, and ±0 added to a term leaves
 // the light's sum as it is (\`exactZeros.test.ts\`).
 var transmitted=vec3f(0.0);
 if(any(thinSubsurface!=vec3f(0.0))){transmitted=thinSubsurface*thinTransmission(dot(N,${shadowed ? 'toward' : 'normalize(incidence.xyz)'}),energy);}
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return ${term(pair, (rgb, metal) => `(modelLight(${rgb},${metal},N,incidence.xyz,energy,ao)+transmitted)*color`)};}
 return ${term(pair, (rgb, metal) => `(standardLighting(${rgb},${metal},rough,N,V,vec4f(incidence.xyz,energy))+transmitted)*color`)};
}`

/**
 * With `pair`, the light's two terms from one walk (`declaredLightPair`): on the surface, and on a
 * null albedo — the water's lit colour and its reflection's specular (`../../webgpu/water/compositeWgsl.ts`).
 * Each is the expression `declaredLight` returns, with `rgb`, `metal` or `vec3f(0.0)`, `0.0` where
 * it passes its arguments; what they share — the incidence, the shadow read, the transmission —
 * reads no albedo, so it is read once and both terms are those of two walks, bit for bit.
 */
const LIGHT_PAIR_WGSL = `
struct LightPair{lit:vec3f,specular:vec3f,}`
const zero = (pair: boolean) => (pair ? 'LightPair(vec3f(0.0),vec3f(0.0))' : 'vec3f(0.0)')
const term = (pair: boolean, of: (rgb: string, metal: string) => string) =>
  pair ? `LightPair(${of('rgb', 'metal')},${of('vec3f(0.0)', '0.0')})` : of('rgb', 'metal')

/** A rectangle light's term, before any punctual one's: \`declaredLight\` with \`rects\`. */
const rectBranchWgsl = (pair: boolean) => `
 if(isRect(light)){
  var transmitted=vec3f(0.0);
  if(any(thinSubsurface>vec3f(0.0))){transmitted=thinSubsurface*rectIrradiance(light,P,-N).w*${INVERSE_PI}*light.colorIntensity.rgb*light.colorIntensity.w;}
  return ${term(pair, (rgb, metal) => `rectLight(light,${rgb},${metal},rough,N,V,P,ao)+transmitted`)};
 }`

const shadeWgsl = (pair: boolean) => `
 // A surface facing away from the light gets its exact zero whatever the shadow: the filter's
 // taps are skipped, never the page reads and requests (\`shadowPcf\`). Toon bands light it.
 let toward=normalize(incidence.xyz);
 let back=any(thinSubsurface>vec3f(0.0))&&dot(N,incidence.xyz)<0.0;
 let facing=back||surfaceModel==${MODEL_FLAG.toon}u||select(dot(N,toward),dot(N,incidence.xyz),surfaceModel==${MODEL_FLAG.diffuse}u)>0.0;
 let shade=shadowFactor(i32(light.params.y),light,P+shadowReceiverOffset,shadowBiasNormal(select(N,-N,back),shadowReceiverPlane),facing);
 if(shade<=0.0){return ${zero(pair)};}`

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
 * program runs the loop without the reject.
 */
export const sliceLightingWgsl = (reject: boolean, pair = false) => `
fn sliceLighting${pair ? 'Pair' : ''}(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->${pair ? 'LightPair' : 'vec3f'}{
 var result=${zero(pair)};
 for(var index=0u;index<slice.y;index++){
  var light=index;if(slice.x!=TILE_NO_SLICE){light=tileLights[slice.x+index];}${reject ? RANGE_REJECT_WGSL : ''}
  ${pair ? PAIR_SUM_WGSL : 'result+=declaredLight(directLights.items[light],rgb,metal,rough,N,V,P,ao);'}
 }
 return result;
}`

/** \`sliceLighting\` with \`pair\`: each sum in the same order as its own walk's. */
const PAIR_SUM_WGSL = `let term=declaredLightPair(directLights.items[light],rgb,metal,rough,N,V,P,ao);
  result.lit+=term.lit;result.specular+=term.specular;`

const RANGE_REJECT_WGSL = `
  let sphere=directLights.items[light].positionRange;
  let offset=sphere.xyz-P;
  if(!isSunKind(directLights.items[light].params.x)&&dot(offset,offset)>sphere.w*sphere.w*RANGE_REJECT){continue;}`
