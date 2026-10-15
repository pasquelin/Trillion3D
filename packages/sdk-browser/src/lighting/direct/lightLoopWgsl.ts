import { MODEL_FLAG } from '../../scene/surfaceModel.ts'
import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { INCIDENCE, REACH, irradianceTerm } from './lightTermsWgsl.ts'

/**
 * The contribution of one declared light at the point, its shadow included — the engine's only
 * lighting formula. A light out of range, or fully in shadow, yields exactly zero.
 *
 * `term` is what the light gives (`LightTerm`):
 * - `surface`, a pixel's radiance toward its eye (`declaredLight`): its shadow the virtual shadow
 *   maps' (`shadowFactor`), which hold the receivers the view marks, and its response the surface
 *   model's;
 * - `irradiance`, what a point of the bounce cache receives (`declaredIrradiance`, `../../bounce/`),
 *   wherever in the world, mostly off screen: its shadow one ray through the resident proxy
 *   (`rtBlocked`), a rectangle's toward its centre, whatever the view, and its response the cosine alone — the cache multiplies
 *   by its albedo over π. The maps would leave an off-screen point unshadowed, or draw pages no
 *   view asks for: each term's visibility is the one its points can read.
 * The incidence, the range, the rectangle's irradiance and the light's colour and intensity are
 * the same text in both.
 *
 * What `key` (`ContractKey`, `LOBELESS_KEY` unless given) leaves out is not compiled. With
 * `unshadowed` (#1249), the program of a scene no light of which holds a shadow slot: every
 * light's `shadowFactor` answers exactly one and a transmission of exactly one, so the same terms
 * without them are the same product, bit for bit (`tests/gpu/lighting/narrow-resolve.gpu.ts`),
 * with none of the shadow code compiled in. That code costs an unshadowed light 40 % of its
 * evaluation although it runs none of it — the registers it holds lower the pixels in flight —,
 * timed on the resolve of 64 lamps; the program is chosen per frame (`contractVariants.ts`).
 *
 * With `rectless` (#1369), the program of a scene that holds no rectangle light: \`isRect\` answers
 * false for every light, so the branch it guards never runs and its absence changes no term. The
 * rectangle's shading — its clipped polygon and fitted lobe (\`rectLightWgsl.ts\`) — is the largest
 * code of the loop: left out, every punctual light of the loop runs without the registers it holds.
 *
 * Without `lobeless`, the program of an image that holds an anisotropic or clear-coat surface
 * (`lobesWgsl.ts`): the same `surfaceLight` and `rectLight`, whose lobe hooks run the very same
 * terms on a pixel without lobes.
 *
 * `shading` is what the pixel's lights share of its surface (`lobeSurface`), taken once before the
 * loop (`sliceLighting`); with `pair`, `dielectric` the null albedo's.
 */
export const declaredLightWgsl = (
  key: Partial<ContractKey> = LOBELESS_KEY,
  { pair = false, term = 'surface' }: { pair?: boolean; term?: LightTerm } = {},
) => {
  const shadowed = !key.unshadowed,
    surface = term === 'surface'
  return wgslBlock(
    `declaredLightWgsl(${variantLabel(key)}, ${pair}, ${term})`,
    [...(pair ? [LIGHT_PAIR_WGSL] : []), ...(surface ? [lambertDiffuse] : [])],
    surface
      ? `fn declaredLight${pair ? 'Pair' : ''}(rank:u32,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,shading:LobeSurface${pair ? ',dielectric:LobeSurface' : ''})->${pair ? 'LightPair' : 'vec3f'}{${REACH(zero(pair))}${key.rectless ? '' : rectBranch(pair)}${INCIDENCE(zero(pair))}${shadowed ? shadeStatement(pair) : ''}
 let energy=light.colorIntensity.w*incidence.w${shadowed ? '*shade' : ''};
 let color=light.colorIntensity.rgb${shadowed ? '*shadowTransmission' : ''};
 // A surface with no thin transmission adds an exact zero: 0·x is ±0, and ±0 added to a term leaves
 // the light's sum as it is (\`exactZeros.test.ts\`). Its back takes the light's cosine from behind.
 var transmitted=vec3f(0.0);
 if(thinSurface()){transmitted=lambertDiffuse(thinSubsurface,0.0,vec3f(max(-dot(N,incidence.xyz),0.0)*energy),1.0);}
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return ${terms(pair, (rgb, metal) => `(modelLight(${rgb},${metal},N,incidence.xyz,energy,ao)+transmitted)*color`)};}
 return ${terms(pair, (_rgb, _metal, shading) => `(surfaceLight(${shading},N,V,vec4f(incidence.xyz,energy))+transmitted)*color`)};
}`
      : `fn declaredIrradiance(rank:u32,P:vec3f,N:vec3f,reach:f32)->vec3f{${REACH('vec3f(0.0)')}${irradianceTerm(key.rectless)}
}`,
  )
}

/** What a light gives (`declaredLightWgsl`): a pixel's radiance through the maps, or a point's
 *  irradiance through the proxy. */
export type LightTerm = 'surface' | 'irradiance'

/**
 * With `pair`, the light's two terms from one walk (`declaredLightPair`): on the surface, and on a
 * null albedo — the water's lit colour and its specular (`../../webgpu/water/compositeWgsl.ts`).
 * Each is the expression `declaredLight` returns, with `rgb`, `metal`, `shading` or `vec3f(0.0)`,
 * `0.0`, `dielectric` — a dielectric's reflectance and no diffuse — where it passes its arguments;
 * what they share — the incidence, the shadow read, the transmission —
 * reads no albedo, so it is read once and both terms are those of two walks, bit for bit.
 */
const LIGHT_PAIR_WGSL = wgslBlock(
  'LIGHT_PAIR_WGSL',
  [],
  'struct LightPair{lit:vec3f,specular:vec3f,}',
)
const zero = (pair: boolean) => (pair ? 'LightPair(vec3f(0.0),vec3f(0.0))' : 'vec3f(0.0)')
const terms = (pair: boolean, of: (rgb: string, metal: string, shading: string) => string) =>
  pair
    ? `LightPair(${of('rgb', 'metal', 'shading')},${of('vec3f(0.0)', '0.0', 'dielectric')})`
    : of('rgb', 'metal', 'shading')

/** A rectangle light's term, before any punctual one's: \`declaredLight\` without \`rectless\`. Its
 *  view from the point serves its front and, on a thin surface, its back (the Lambert diffuse of the
 *  back's irradiance, as a punctual light's). */
const rectBranch = (pair: boolean) => `
 if(isRect(light)){
  let r=rectView(light,P);
  var transmitted=vec3f(0.0);
  if(thinSurface()){transmitted=lambertDiffuse(thinSubsurface,0.0,vec3f(rectIrradianceOf(r,-N).w*light.colorIntensity.w),1.0)*light.colorIntensity.rgb;}
  return ${terms(pair, (rgb, metal, shading) => `rectLight(light,r,${shading},${rgb},${metal},rough,N,V,ao)+transmitted`)};
 }`

const shadeStatement = (pair: boolean) => `
 // A surface facing away from the light gets its exact zero whatever the shadow: the shadow's
 // trace is skipped (\`shadowFactor\`). Toon bands light it. The direction is unit as it comes.
 let cosine=dot(N,incidence.xyz);
 let back=thinSurface()&&cosine<0.0;
 let facing=back||surfaceModel==${MODEL_FLAG.toon}u||cosine>0.0;
 let shade=shadowFactor(i32(light.params.y),light,P+shadowReceiverOffset,vsmBiasNormal(select(N,-N,back),shadowReceiverPlane),facing);
 if(shade<=0.0){return ${zero(pair)};}`

/**
 * The one loop that walks a point's lights: a pixel's in full (\`sliceLighting\`), the lights of a
 * cell's list (\`cellSlice\`, \`listedLight\`) in increasing rank; a bounce point's irradiance
 * (\`lightsIrradiance\`, \`term\` \`irradiance\`), the lights of its cell of the world grid
 * (\`bounceLightSlice\`). Every walk hands the light's RANK to its term, whose first statement is the
 * one reach test (\`REACH\`, \`lightReaches\`) on the light's kind and sphere: a light out of reach
 * costs those words and a compare, in every program, before the rest of its record is read.
 */
export const sliceLightingWgsl = (pair = false, term: LightTerm = 'surface') =>
  wgslBlock(
    `sliceLightingWgsl(${pair}, ${term})`,
    [],
    term === 'surface'
      ? `
fn sliceLighting${pair ? 'Pair' : ''}(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->${pair ? 'LightPair' : 'vec3f'}{
 var result=${zero(pair)};
 let shading=lobeSurface(rgb,metal,rough,N,V);lobeView(shading);${pair ? '\n let dielectric=lobeSurface(vec3f(0.0),0.0,rough,N,V);' : ''}
 for(var index=0u;index<slice.y;index++){
  ${pair ? PAIR_SUM : 'result+=declaredLight(listedLight(slice,index),rgb,metal,rough,N,V,P,ao,shading);'}
 }
 return result;
}`
      : `
fn lightsIrradiance(P:vec3f,N:vec3f,reach:f32)->vec3f{
 let slice=bounceLightSlice(P);
 var result=vec3f(0.0);
 for(var index=0u;index<slice.y;index++){
  result+=declaredIrradiance(listedLight(slice,index),P,N,reach);
 }
 return result;
}`,
  )

/** \`sliceLighting\` with \`pair\`: each sum in the same order as its own walk's. */
const PAIR_SUM = `let term=declaredLightPair(listedLight(slice,index),rgb,metal,rough,N,V,P,ao,shading,dielectric);
  result.lit+=term.lit;result.specular+=term.specular;`

/**
 * A bounce point's irradiance (\`lightsIrradiance\`): the light term and its loop, over the lights of the point's cell of the world light grid (\`bounceLightSlice\`,
 * \`../../bounce/lightCellWgsl.ts\`, which its module lists with the light grid's buffer).
 */
export const LIGHTS_IRRADIANCE_WGSL = wgslBlock(
  'LIGHTS_IRRADIANCE_WGSL',
  [declaredLightWgsl({}, { term: 'irradiance' }), sliceLightingWgsl(false, 'irradiance')],
  '',
)
