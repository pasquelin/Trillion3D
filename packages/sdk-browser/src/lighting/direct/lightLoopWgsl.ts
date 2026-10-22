import { MODEL_FLAG } from '../../materials/surface/surfaceModel.ts'
import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { INCIDENCE, REACH, irradianceTerm } from './lightTermsWgsl.ts'
import { LAMP_WGSL } from './lampSeenWgsl.ts'

/**
 * A shadow catcher's term (`catcherAlpha`, `../../materials/surface/surfaceModel.ts`): of a light that holds a
 * shadow slot, the light's energy at the point that its shadow lets through — its translucent
 * casters' colour averaged in — in `x`, and all of it in `y`; of any other light, nothing. A
 * program with no shadow code has no shadowed light, and a rectangle casts no shadow: their terms
 * are zero (`CATCHER_NONE`).
 */
const CATCHER_SHADOWED = (out: Out) => `
 if(surfaceModel==${MODEL_FLAG.shadow}u){
  let weight=select(0.0,light.colorIntensity.w*lamp.falloff,i32(light.params.y)>=0);
  return ${out('vec3f(weight*shade*dot(shadowTransmission,vec3f(1.0/3.0)),weight,0.0)')};
 }`
const CATCHER_NONE = (out: Out) => `
 if(surfaceModel==${MODEL_FLAG.shadow}u){return ${out('vec3f(0.0)')};}`

/** A term's return of \`v\`, a light's whole term; a split term's (\`LightSplit\`), its specular
 *  share, a catcher's term and a thin back's transmission riding there as the subtraction of the two
 *  sums left them (\`declaredLightSplit\`). */
type Out = (v: string) => string
const WHOLE: Out = (v) => v
const SPECULAR: Out = (v) => `LightSplit(vec3f(0.0),${v})`

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
 * loop (`sliceLighting`).
 */
export const declaredLightWgsl = (
  key: Partial<ContractKey> = LOBELESS_KEY,
  { term = 'surface' }: { term?: LightTerm } = {},
) => {
  const shadowed = !key.unshadowed
  if (term === 'irradiance')
    return wgslBlock(
      `declaredLightWgsl(${variantLabel(key)}, ${term})`,
      [LAMP_WGSL],
      `fn declaredIrradiance(rank:u32,P:vec3f,N:vec3f,reach:f32)->vec3f{${REACH('vec3f(0.0)')}${irradianceTerm(key.rectless)}
}`,
    )
  const split = term === 'split'
  const out = split ? SPECULAR : WHOLE
  const zero = out(ZERO)
  return wgslBlock(
    `declaredLightWgsl(${variantLabel(key)}, ${term})`,
    [lambertDiffuse, LAMP_WGSL],
    `${split ? SPLIT_HEAD : WHOLE_HEAD}${REACH(zero)}${key.rectless ? '' : rectBranch(split)}${INCIDENCE(zero)}
 let lamp=lampSeen(light,P,N,incidence,LAMP_BIAS);${shadowed ? shadeStatement(out) : CATCHER_NONE(out)}
 let energy=light.colorIntensity.w*lamp.falloff${shadowed ? '*shade' : ''};
 let color=light.colorIntensity.rgb${shadowed ? '*shadowTransmission' : ''};
 // A surface with no thin transmission adds an exact zero: 0·x is ±0, and ±0 added to a term leaves
 // the light's sum as it is (\`exactZeros.test.ts\`). Its back takes the light's cosine from behind.
 var transmitted=vec3f(0.0);
 if(thinSurface()){transmitted=lambertDiffuse(thinSubsurface,0.0,vec3f(max(-lamp.side,0.0)*energy),1.0);}
${split ? SPLIT_TAIL : WHOLE_TAIL}
}`,
  )
}

const WHOLE_HEAD =
  'fn declaredLight(rank:u32,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,shading:LobeSurface)->vec3f{'
const WHOLE_TAIL = ` if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return (modelLight(rgb,metal,N,lamp.toward,energy,ao)+transmitted)*color;}
 return (lampLight(shading,N,V,light,P,lamp,energy)+transmitted)*color;`
/** The split term (\`declaredLightSplit\`, a translucent layer's forward lighting): the whole
 *  term's two shares, from one shadow read — its diffuse layer, and the rest: the lobe's specular
 *  (\`specularShading\`, the pixel's surface with no diffuse albedo), the thin back's
 *  transmission, a catcher's term. */
const SPLIT_HEAD = `struct LightSplit{diffuse:vec3f,specular:vec3f,}
fn declaredLightSplit(rank:u32,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,shading:LobeSurface,specularShading:LobeSurface)->LightSplit{`
const SPLIT_TAIL = ` if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return LightSplit(modelLight(rgb,metal,N,lamp.toward,energy,ao)*color,transmitted*color);}
 // The base lobe's diffuse share (\`lobeSum\`) under what the coat lets through, as \`lampLight\`
 // weighs it.
 let diffuse=shading.diffuse*(energy*lamp.cosine)*lobeThrough();
 return LightSplit(diffuse*color,(lampLight(specularShading,N,V,light,P,lamp,energy)+transmitted)*color);`

/** What a light gives (`declaredLightWgsl`): a pixel's radiance through the maps, the same split
 *  into its diffuse and specular shares, or a point's irradiance through the proxy. */
type LightTerm = 'surface' | 'split' | 'irradiance'

const ZERO = 'vec3f(0.0)'

/** A rectangle light's term, before any punctual one's: \`declaredLight\` without \`rectless\`. Its
 *  view from the point serves its front and, on a thin surface, its back (the Lambert diffuse of the
 *  back's irradiance, as a punctual light's). It casts no shadow: nothing of it for a catcher. Split,
 *  its two shares from one evaluation (\`rectLightSplit\`). */
const rectBranch = (split: boolean) => `
 if(isRect(light)){${CATCHER_NONE(split ? SPECULAR : WHOLE)}
  let r=rectView(light,P);
  var transmitted=vec3f(0.0);
  if(thinSurface()){transmitted=lambertDiffuse(thinSubsurface,0.0,vec3f(rectIrradianceOf(r,-N).w*light.colorIntensity.w),1.0)*light.colorIntensity.rgb;}${
    split
      ? `
  let t=rectLightSplit(light,r,shading,rgb,metal,rough,N,V,ao);
  return LightSplit(t[0],t[1]+transmitted);`
      : `
  return rectLight(light,r,shading,rgb,metal,rough,N,V,ao)+transmitted;`
  }
 }`

const shadeStatement = (out: Out) => `
 // A surface facing away from the light gets its exact zero whatever the shadow: the shadow's
 // trace is skipped (\`shadowFactor\`). Toon bands light it, a shadow catcher reads the shadow
 // whatever its side; a lamp of size lights a surface a little past its horizon (\`lampSeen\`). The
 // direction is unit as it comes.
 let back=thinSurface()&&lamp.side<0.0;
 let facing=back||surfaceModel==${MODEL_FLAG.toon}u||surfaceModel==${MODEL_FLAG.shadow}u||lamp.side>0.0||lamp.cosine>0.0;
 let shade=shadowFactor(i32(light.params.y),light,P+shadowReceiverOffset,vsmBiasNormal(select(N,-N,back),shadowReceiverPlane),facing);${CATCHER_SHADOWED(out)}
 if(shade<=0.0){return ${out(ZERO)};}`

/**
 * The one loop that walks a point's lights: a pixel's in full (\`sliceLighting\`; split into its
 * diffuse and specular shares, \`sliceLightingSplit\`), the lights of a
 * cell's list (\`cellSlice\`, \`listedLight\`) in increasing rank; a bounce point's irradiance
 * (\`lightsIrradiance\`, \`term\` \`irradiance\`), the lights of its cell of the world grid
 * (\`bounceLightSlice\`). Every walk hands the light's RANK to its term, whose first statement is the
 * one reach test (\`REACH\`, \`lightReaches\`) on the light's kind and sphere: a light out of reach
 * costs those words and a compare, in every program, before the rest of its record is read.
 */
export const sliceLightingWgsl = (term: LightTerm = 'surface') =>
  wgslBlock(
    `sliceLightingWgsl(${term})`,
    [],
    term === 'split'
      ? `
fn sliceLightingSplit(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->LightSplit{
 var result=LightSplit(vec3f(0.0),vec3f(0.0));
 let shading=lobeSurface(rgb,metal,rough,N,V);lobeView(shading);
 var specularShading=shading;
 specularShading.diffuse=vec3f(0.0);
 for(var index=0u;index<slice.y;index++){
  let l=declaredLightSplit(listedLight(slice,index),rgb,metal,rough,N,V,P,ao,shading,specularShading);
  result.diffuse+=l.diffuse;
  result.specular+=l.specular;
 }
 return result;
}`
      : term === 'surface'
        ? `
fn sliceLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->vec3f{
 var result=vec3f(0.0);
 let shading=lobeSurface(rgb,metal,rough,N,V);lobeView(shading);
 for(var index=0u;index<slice.y;index++){
  result+=declaredLight(listedLight(slice,index),rgb,metal,rough,N,V,P,ao,shading);
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

/**
 * A bounce point's irradiance (\`lightsIrradiance\`): the light term and its loop, over the lights of the point's cell of the world light grid (\`bounceLightSlice\`,
 * \`../../bounce/lightCellWgsl.ts\`, which its module lists with the light grid's buffer).
 */
export const LIGHTS_IRRADIANCE_WGSL = wgslBlock(
  'LIGHTS_IRRADIANCE_WGSL',
  [declaredLightWgsl({}, { term: 'irradiance' }), sliceLightingWgsl('irradiance')],
  '',
)
