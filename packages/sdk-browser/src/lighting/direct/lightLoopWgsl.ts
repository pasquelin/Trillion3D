import { MODEL_FLAG } from '../../scene/surfaceModel.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'

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
 *   (`rtBlocked`), whatever the view, and its response the cosine alone — the cache multiplies
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
 * (`lobesWgsl.ts`): a light goes through `lobeLight` and `lobeRectLight`, which run the very same
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
    lobes = !key.lobeless,
    surface = term === 'surface'
  return wgslBlock(
    `declaredLightWgsl(${variantLabel(key)}, ${pair}, ${term})`,
    [...(pair ? [LIGHT_PAIR_WGSL] : []), ...(key.rectless || !surface ? [] : [INVERSE_PI])],
    surface
      ? `fn declaredLight${pair ? 'Pair' : ''}(light:DirectLight,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,shading:LobeSurface${pair ? ',dielectric:LobeSurface' : ''})->${pair ? 'LightPair' : 'vec3f'}{${key.rectless ? '' : rectBranch(pair, lobes)}${INCIDENCE(zero(pair))}${shadowed ? shadeStatement(pair) : ''}
 let energy=light.colorIntensity.w*incidence.w${shadowed ? '*shade' : ''};
 let color=light.colorIntensity.rgb${shadowed ? '*shadowTransmission' : ''};
 // A surface with no thin transmission adds an exact zero: 0·x is ±0, and ±0 added to a term leaves
 // the light's sum as it is (\`exactZeros.test.ts\`).
 var transmitted=vec3f(0.0);
 if(any(thinSubsurface!=vec3f(0.0))){transmitted=thinSubsurface*thinTransmission(dot(N,${shadowed ? 'toward' : 'normalize(incidence.xyz)'}),energy);}
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return ${terms(pair, (rgb, metal) => `(modelLight(${rgb},${metal},N,incidence.xyz,energy,ao)+transmitted)*color`)};}
 return ${terms(pair, (_rgb, _metal, shading) => `(${lobes ? 'lobeLight' : 'surfaceLight'}(${shading},N,V,vec4f(incidence.xyz,energy))+transmitted)*color`)};
}`
      : `fn declaredIrradiance(light:DirectLight,P:vec3f,N:vec3f,reach:f32)->vec3f{${key.rectless ? '' : IRRADIANCE_RECT}${INCIDENCE('vec3f(0.0)')}${IRRADIANCE_TERM}
}`,
  )
}

/** What a light gives (`declaredLightWgsl`): a pixel's radiance through the maps, or a point's
 *  irradiance through the proxy. */
export type LightTerm = 'surface' | 'irradiance'

/** The light's incidence at \`P\`, and its exact zero out of its range or its cone. */
const INCIDENCE = (zeroTerm: string) => `
 let incidence=directIncidence(light,P);
 if(incidence.w<=0.0){return ${zeroTerm};}`

/** A rectangle's irradiance: its whole contribution, unshadowed — its maps hold no shadow. */
const IRRADIANCE_RECT = `
 // A rectangle casts no shadow: its irradiance is its whole contribution.
 if(isRect(light)){return light.colorIntensity.rgb*light.colorIntensity.w*rectIrradiance(light,P,N).w;}`

/**
 * A punctual light's irradiance through the proxy: its cosine, then — where it adds light and casts
 * a shadow — one ray toward it through the resident proxy, which keeps a closed door closed for the
 * bounce as for the direct term. Every shadow-casting light that adds light at the point is tested:
 * one left untested would shine through the wall. A sun's ray reaches \`reach\`, a lamp's the lamp.
 */
const IRRADIANCE_TERM = `
 let cosine=dot(N,incidence.xyz);
 if(cosine<=0.0){return vec3f(0.0);}
 let lit=light.colorIntensity.rgb*light.colorIntensity.w*incidence.w*cosine;
 if(all(lit==vec3f(0.0))){return lit;}
 if(light.params.z>0.5){
  let span=select(length(light.positionRange.xyz-P),reach,isSun(light));
  if(rtBlocked(P+N*1e-3,incidence.xyz,span)){return vec3f(0.0);}
 }
 return lit;`

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

/** A rectangle light's term, before any punctual one's: \`declaredLight\` without \`rectless\`. */
const rectBranch = (pair: boolean, lobes: boolean) => `
 if(isRect(light)){
  var transmitted=vec3f(0.0);
  if(any(thinSubsurface>vec3f(0.0))){transmitted=thinSubsurface*rectIrradiance(light,P,-N).w*INVERSE_PI*light.colorIntensity.rgb*light.colorIntensity.w;}
  return ${terms(pair, (rgb, metal, shading) => `${lobes ? 'lobeRectLight' : 'rectLight'}(light,${rgb},${metal},rough,N,V,P,ao${lobes ? `,${shading}.f0` : ''})+transmitted`)};
 }`

const shadeStatement = (pair: boolean) => `
 // A surface facing away from the light gets its exact zero whatever the shadow: the shadow's
 // trace is skipped (\`shadowFactor\`). Toon bands light it.
 let toward=normalize(incidence.xyz);
 let back=any(thinSubsurface>vec3f(0.0))&&dot(N,incidence.xyz)<0.0;
 let facing=back||surfaceModel==${MODEL_FLAG.toon}u||select(dot(N,toward),dot(N,incidence.xyz),surfaceModel==${MODEL_FLAG.diffuse}u)>0.0;
 let shade=shadowFactor(i32(light.params.y),light,P+shadowReceiverOffset,shadowBiasNormal(select(N,-N,back),shadowReceiverPlane),facing);
 if(shade<=0.0){return ${zero(pair)};}`

/**
 * The one loop that walks a point's lights: a pixel's in full (\`sliceLighting\`), the lights of a
 * cell's list (\`cellSlice\`) — or, from \`TILE_NO_SLICE\`, every light of the scene — in increasing
 * rank; a bounce point's irradiance (\`lightsIrradiance\`, \`term\` \`irradiance\`), every light of
 * the scene, which no list of the view's grid holds (its cells are the view's own).
 *
 * With \`reject\`, a light is first rejected on its sphere alone, before its record is read in full,
 * where it lies past its range by a ten-thousandth of its squared range (\`RANGE_REJECT\`): there
 * \`directIncidence\` — and a rectangle's range window — would have returned zero before any
 * shading, so the sum loses an exact zero only. The kind is read alone (\`isSunKind\`), not through
 * \`isSun\`, which takes the whole record. Timed on the resolve (64 lamps, a million pixels), it
 * takes 30 % off a light out of range for 13 % on one in range: in the resolve program with shadow
 * code that 13 % is not repaid (42.3 → 47.9 ps a light in range), so that program runs the loop
 * without the reject (#1249). The irradiance always rejects: a light in range there costs a ray
 * through the proxy, which the sphere test's few words do not weigh.
 */
export const sliceLightingWgsl = (reject: boolean, pair = false, term: LightTerm = 'surface') =>
  wgslBlock(
    `sliceLightingWgsl(${reject}, ${pair}, ${term})`,
    [],
    term === 'surface'
      ? lightLoop(
          `sliceLighting${pair ? 'Pair' : ''}(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->${pair ? 'LightPair' : 'vec3f'}`,
          `
 var result=${zero(pair)};
 let shading=lobeSurface(rgb,metal,rough,N,V);${pair ? '\n let dielectric=lobeSurface(vec3f(0.0),0.0,rough,N,V);' : ''}`,
          'slice.y',
          LISTED_PICK,
          reject,
          pair
            ? PAIR_SUM
            : 'result+=declaredLight(directLights.items[light],rgb,metal,rough,N,V,P,ao,shading);',
        )
      : lightLoop(
          'lightsIrradiance(P:vec3f,N:vec3f,reach:f32)->vec3f',
          `
 let slice=bounceLightSlice(P);
 var result=vec3f(0.0);`,
          'slice.y',
          LISTED_PICK,
          reject,
          'result+=declaredIrradiance(directLights.items[light],P,N,reach);',
        ),
  )

/** The loop's text: \`head\` its signature, \`start\` its result and what its lights share, \`count\`
 *  its lights, \`pick\` the rank a light is read at, \`sum\` what a light adds. */
const lightLoop = (
  head: string,
  start: string,
  count: string,
  pick: string,
  reject: boolean,
  sum: string,
) => `
fn ${head}{${start}
 for(var index=0u;index<${count};index++){
  ${pick}${reject ? RANGE_REJECT_TEST : ''}
  ${sum}
 }
 return result;
}`

/** A listed light's rank: the list's word, or, from \`TILE_NO_SLICE\`, every light in turn. */
const LISTED_PICK = 'var light=index;if(slice.x!=TILE_NO_SLICE){light=tileLights[slice.x+index];}'

/** \`sliceLighting\` with \`pair\`: each sum in the same order as its own walk's. */
const PAIR_SUM = `let term=declaredLightPair(directLights.items[light],rgb,metal,rough,N,V,P,ao,shading,dielectric);
  result.lit+=term.lit;result.specular+=term.specular;`

const RANGE_REJECT_TEST = `
  let sphere=directLights.items[light].positionRange;
  let offset=sphere.xyz-P;
  if(!isSunKind(directLights.items[light].params.x)&&dot(offset,offset)>sphere.w*sphere.w*RANGE_REJECT){continue;}`

/**
 * A bounce point's irradiance (\`lightsIrradiance\`): the light term and its loop, with the range
 * reject, over the lights of the point's cell of the world light grid (\`bounceLightSlice\`,
 * \`../../bounce/lightCellWgsl.ts\`, which its module lists with the light grid's buffer).
 */
export const LIGHTS_IRRADIANCE_WGSL = wgslBlock(
  'LIGHTS_IRRADIANCE_WGSL',
  [declaredLightWgsl({}, { term: 'irradiance' }), sliceLightingWgsl(true, false, 'irradiance')],
  '',
)
