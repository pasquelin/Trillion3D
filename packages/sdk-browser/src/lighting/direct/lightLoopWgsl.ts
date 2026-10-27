import { MODEL_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { LOBELESS_KEY, type ContractKey, variantLabel } from '../deferred/contractCuts.ts'
import { LAMP_SEEN, REACH, irradianceTerm } from './lightTermsWgsl.ts'
import { LAMP_WGSL } from './lampSeenWgsl.ts'
import { THIN_TRANSMISSION_WGSL } from './thinTransmissionWgsl.ts'
import { SHADING_MODEL_LIGHT_WGSL } from './shadingModelWgsl.ts'
import { PROFILE_LIGHT_WGSL, PROFILE_RECT_WGSL } from './profileModelWgsl.ts'
import {
  CATCHER_NONE,
  CATCHER_SHADOWED,
  FACING_MODELS,
  hairOnly,
  lampModelTerm,
  rectModelTerm,
  scattered,
  type Out,
} from './surfaceModelTerms.ts'
import { vsmFacesAwayFromLocal } from '../shadows/vsm/facesAwayWgsl.ts'
import { AIR_TINT_WGSL } from '../atmosphere/airTintWgsl.ts'
import { contactShadowWgsl } from '../contactShadow/contactShadowWgsl.ts'
import { SHADOW_TERMS_WGSL } from './shadowTermsWgsl.ts'

/**
 * What a program's light term holds of the surface models: `models`, the diffuse and toon models, the
 * shadow catcher (`surfaceModel`) and the shading models a graph picks per pixel (`pixelModel`), `thin`, the thin two-sided surface's transmission
 * (`thinSurface`). A program that lights tiles of plain physical surfaces alone
 * (`../deferred/tileClass.ts`) leaves both out: the branches they guard never run on its pixels, so
 * their absence changes no term. Both held, the term is the one every other program runs.
 */
export type LightCut = { models: boolean; thin: boolean }
const FULL_CUT: LightCut = { models: true, thin: true }
/** The suffix of a block name that names a cut: none for the whole term. */
const cutLabel = ({ models, thin }: LightCut) =>
  models && thin ? '' : `, ${models ? 'models' : 'no models'}, ${thin ? 'thin' : 'no thin'}`
/** The term's statements about a shadow catcher, where the program holds the models. */
const catcherOf = (cut: LightCut, text: string) => (cut.models ? text : '')

/** The returns of a term (\`Out\`): a light's whole term; a split term's (\`LightSplit\`), its specular
 *  share, a catcher's term and a thin back's transmission riding there as the subtraction of the two
 *  sums left them (\`declaredLightSplit\`). */
const WHOLE: Out = (v) => v
const SPECULAR: Out = (v) => `LightSplit(vec3f(0.0),${v})`

/** The part of a program's label that names the air's tint left out (`airTint` false). */
export const airTintLabel = (airTint: boolean) => (airTint ? '' : ', no air tint')

/**
 * The light's shadow terms (`shadowTermsOf`): its shadow `shade` (1 in a program with no shadow code), the
 * pixel's occlusion `ao`, whether the light has shadow bits (`casts`: it casts a shadow, whether it holds
 * a slot or not and whether the program holds the shadow code or not), and its contact shadow.
 */
const termsOf = (reads: boolean, contact: boolean) =>
  `shadowTermsOf(${reads ? 'shade' : '1.0'},ao,casts,${contact ? 'contact' : '1.0'})`

/**
 * The contribution of one declared light at the point, its shadow included — the engine's only
 * lighting formula. A light out of range, or fully in shadow, yields exactly zero.
 *
 * `term` is what the light gives (`LightTerm`):
 * - `surface`, a pixel's radiance toward its eye (`declaredLight`): its shadow the virtual shadow
 *   maps' (`shadowFactor`), which hold the receivers the view marks, and its response the surface
 *   model's;
 * - `irradiance`, what a point of the surface cache receives (`declaredIrradiance`), wherever in the
 *   world, mostly off screen: no shadow, the program that holds it traces its own, and its response
 *   the cosine alone — the cache multiplies by its albedo over π. The maps would leave an off-screen
 *   point unshadowed, or draw pages no view asks for: each term's visibility is the one its points
 *   can read. `bareIrradiance` (`declaredBareIrradiance`) is the same without the light function and the
 *   clouds' shade, which the program that holds it keeps, with the shadow, in a mask of its own.
 * The lamp's falloff, the range, the rectangle's irradiance and the light's colour and intensity are
 * the same text in both. A light's colour is multiplied by its light function at the point
 * (`lightFunctionOf`, `../lightFunction/readWgsl.ts`) in the surface, split and irradiance terms.
 * It is also multiplied by the air's transmittance toward it at the point where it asks for that
 * (`airTintOf`, `../atmosphere/airTintWgsl.ts`). `airTint` false leaves that factor out: it is for a
 * program whose lights are never the air's, the air's lights being directional ones and the local
 * lights' pass walking no other kind. Last, it is multiplied by the share of it the clouds let
 * through where the light has a cloud shadow map (`cloudShadowOnSurface`,
 * `../atmosphere/cloudShadowRead.ts`, not saturated), the program
 * naming what answers it (`lightingBase`).
 *
 * What `key` (`ContractKey`, `LOBELESS_KEY` unless given) leaves out is not compiled. With
 * `unshadowed` (#1249), the program of a scene no light of which holds a shadow slot: every
 * light's `shadowFactor` answers exactly one, so the same terms without it are the same product,
 * bit for bit (`tests/gpu/lighting/narrow-resolve.gpu.ts`),
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
 * (`lobesWgsl.ts`): the same `surfaceLight` and `rectLightSplit`, whose lobe hooks run the very same
 * terms on a pixel without lobes.
 *
 * One step (`shadowTermsOf`, `shadowTermsWgsl.ts`) gives the light's surface and transmission shadows
 * after its shadow read: the lobes take the occlusion `ao` where the light has no shadow bits, else its
 * shadow, the transmitted terms its shadow alone. Without `contactless`, the program of the opaque lit passes
 * that cast contact shadows (`contactShadow`, `../contactShadow/contactShadowWgsl.ts`), the share the
 * contact shadow lets through multiplies both.
 *
 * `shading` is what the pixel's lights share of its surface (`lobeSurface`), taken once before the
 * loop (`sliceLighting`).
 */
export const declaredLightWgsl = (
  key: Partial<ContractKey> = LOBELESS_KEY,
  {
    term = 'surface',
    cut = FULL_CUT,
    airTint = true,
  }: { term?: LightTerm; cut?: LightCut; airTint?: boolean } = {},
) => {
  const shadowed = !key.unshadowed
  const contact = !key.contactless
  if (term === 'irradiance' || term === 'bareIrradiance')
    return wgslBlock(
      `declaredLightWgsl(${variantLabel(key)}, ${term})`,
      [LAMP_WGSL, AIR_TINT_WGSL],
      `fn ${term === 'irradiance' ? 'declaredIrradiance' : 'declaredBareIrradiance'}(rank:u32,P:vec3f,N:vec3f,reach:f32)->vec3f{${REACH('vec3f(0.0)')}${irradianceTerm(key.rectless, term === 'irradiance')}
}`,
    )
  const split = term === 'split'
  const out = split ? SPECULAR : WHOLE
  const zero = out(ZERO)
  // The split term is the translucent layers': none of its pixels wears a model.
  const models = cut.models && !split
  return wgslBlock(
    `declaredLightWgsl(${variantLabel(key)}, ${term}${cutLabel(cut)}${airTintLabel(airTint)})`,
    [
      LAMP_WGSL,
      THIN_TRANSMISSION_WGSL,
      ...(airTint ? [AIR_TINT_WGSL] : []),
      vsmFacesAwayFromLocal,
      SHADOW_TERMS_WGSL,
      ...(models ? [SHADING_MODEL_LIGHT_WGSL, PROFILE_LIGHT_WGSL] : []),
      ...(models && !key.rectless ? [PROFILE_RECT_WGSL] : []),
      ...(contact ? [contactShadowWgsl(models)] : []),
    ],
    `${split ? SPLIT_HEAD : WHOLE_HEAD}${REACH(zero)}${key.rectless ? '' : rectBranch(out, split, shadowed, cut, models, contact)}${LAMP_SEEN(zero, 'LAMP_BIAS')}${shadowed ? shadeStatement(out, cut) : catcherOf(cut, CATCHER_NONE(out))}
 let casts=castsShadow(light);${contact ? `\n let contact=contactShadow(light,P,lamp.centre,casts);` : ''}
 let terms=${termsOf(shadowed, contact)};
 let strength=light.colorIntensity.w*lamp.falloff;
 let transmissionEnergy=strength*terms.transmission;
 let surfaceEnergy=strength*terms.surface;
 let color=light.colorIntensity.rgb*lightFunctionOf(light.params.x,P)*${airTint ? 'airTintOf(rank,light,P)*' : ''}cloudShadowOnSurface(rank,P);
 // A surface with no thin transmission adds an exact zero: 0·x is ±0, and ±0 added to a term leaves
 // the light's sum as it is (\`exactZeros.test.ts\`). A thin one lets the light through from either
 // side, its direction the lamp's centre (\`thinTransmission\`).
 var transmitted=vec3f(0.0);${
   cut.thin
     ? `
 if(thinSurface()){transmitted=thinSubsurface*(thinTransmission(N,V,lamp.centre)*transmissionEnergy);}`
     : ''
 }${lampModelTerm(models)}
${split ? SPLIT_TAIL : wholeTail(cut)}
}`,
  )
}

const WHOLE_HEAD =
  'fn declaredLight(rank:u32,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,shading:LobeSurface)->vec3f{'
const wholeTail = (cut: LightCut) => ` let share=sharesOf(light);${
  cut.models
    ? `
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return (modelLight(rgb,metal,N,lamp.toward,surfaceEnergy)+transmitted)*(color*share.x);}
 ${hairOnly('transmitted*(color*share.x)')}
 ${scattered('color', 'color', 'profileLampLight(shading,N,V,light,P,lamp,surfaceEnergy,rough)')}`
    : ''
}
 if(share.x!=1.0||share.y!=1.0){return (lampLightShares(shading,N,V,light,P,lamp,surfaceEnergy,share)+transmitted*share.x)*color;}
 return (lampLight(shading,N,V,light,P,lamp,surfaceEnergy)+transmitted)*color;`
/** The split term (\`declaredLightSplit\`, a translucent layer's forward lighting): the whole
 *  term's two shares, from one shadow read — its diffuse layer, and the rest: the lobe's specular
 *  (\`lampLightSplit\`), the thin back's transmission, a catcher's term. */
const SPLIT_HEAD = `struct LightSplit{diffuse:vec3f,specular:vec3f,}
fn declaredLightSplit(rank:u32,rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,shading:LobeSurface)->LightSplit{`
const SPLIT_TAIL = ` let share=sharesOf(light);
 if(surfaceModel==${MODEL_FLAG.diffuse}u||surfaceModel==${MODEL_FLAG.toon}u){return LightSplit(modelLight(rgb,metal,N,lamp.toward,surfaceEnergy)*(color*share.x),transmitted*(color*share.x));}
 let split=lampLightSplit(shading,N,V,light,P,lamp,surfaceEnergy);
 return LightSplit(split[0]*(color*share.x),(split[1]*share.y+transmitted*share.x)*color);`

/** What a light gives (`declaredLightWgsl`): a pixel's radiance through the maps, the same split
 *  into its diffuse and specular shares, or a point's irradiance, with or without its light function and clouds' shade. */
type LightTerm = 'surface' | 'split' | 'irradiance' | 'bareIrradiance'

const ZERO = 'vec3f(0.0)'

/** A rectangle light's term, before any punctual one's: \`declaredLight\` without \`rectless\`. Its
 *  view from the point serves its front and, on a thin surface, its transmission (the lobe toward the
 *  rectangle's centre on its form factor with no normal, as a punctual light's). Where it holds a
 *  shadow slot (\`shadowed\`) its whole term — front, specular and back — is the shadow's share of
 *  it, read as a lamp's is (\`shadeRead\`) where the projection traced it: a surface it culls
 *  (\`vsmFacesAwayFromLocal\`, a rectangle's source radius half its width) is the term's exact zero,
 *  a thin one's back is lit from behind and its normal flipped; else nothing of it for a catcher. Its
 *  diffuse and its specular light, one evaluation (\`rectLightSplit\`), are each weighed by the
 *  light's share of it (\`sharesOf\`) and its surface shadow, the back's by the diffuse share and its
 *  transmission shadow (\`shadowTermsOf\`); the split term returns them apart. */
const rectBranch = (
  out: Out,
  split: boolean,
  shadowed: boolean,
  cut: LightCut,
  models: boolean,
  contact: boolean,
) => `
 if(isRect(light)){
  let r=rectView(light,P);${shadowed ? nested(rectShadeRead(out, cut)) : catcherOf(cut, CATCHER_NONE(out))}
  let centre=normalize(light.positionRange.xyz-P);
  let casts=castsShadow(light);${contact ? `\n  let contact=contactShadow(light,P,centre,casts);` : ''}
  let terms=${termsOf(shadowed, contact)};
  let given=lightFunctionOf(light.params.x,P);
  let surfaceGiven=given*terms.surface;
  let transmissionGiven=given*terms.transmission;
  let share=sharesOf(light);
  var transmitted=vec3f(0.0);${
    cut.thin
      ? `
  if(thinSurface()){transmitted=thinSubsurface*(thinTransmission(N,V,centre)*rectWindowed(r)*light.colorIntensity.w)*light.colorIntensity.rgb;}`
      : ''
  }${rectModelTerm(models)}${models ? `\n  ${hairOnly('transmitted*share.x*transmissionGiven')}\n  ${nested(scattered('surfaceGiven', 'transmissionGiven', 'profileRectLight(light,r,shading,N,V,rough)'))}` : ''}
  let t=rectLightSplit(light,r,shading,rgb,metal,rough,N,V);${
    split
      ? `
  return LightSplit(t[0]*share.x*surfaceGiven,t[1]*share.y*surfaceGiven+transmitted*share.x*transmissionGiven);`
      : `
  return (t[0]*share.x+t[1]*share.y)*surfaceGiven+transmitted*share.x*transmissionGiven;`
  }
 }`

/** \`text\` one space deeper: a statement inside a branch, its lines never at the margin a branch's
 *  own end is found by (\`rectlessResolve.test.ts\`). */
const nested = (text: string) => text.replace(/\n/g, '\n ')

/**
 * A light's shadow read, the lamp's and the rectangle's: its share `shade` at the point along
 * \`normal\` (the surface's, or its back's where a thin one is lit from behind), the read made only
 * where the surface is \`facing\` the light (\`shadowFactor\`: else a share of 0); a catcher's term of
 * \`energy\` (\`CATCHER_SHADOWED\`); and the term's exact zero where the share is 0.
 */
const shadeRead = (out: Out, normal: string, facing: string, energy: string, cut: LightCut) => `
 let shade=shadowFactor(i32(light.params.y),light,P,${normal},${facing});${catcherOf(cut, CATCHER_SHADOWED(out, energy))}
 if(shade<=0.0){return ${out(ZERO)};}`

/** A rectangle's shadow read (\`rectBranch\`): the surface faces it where the projection does not
 *  cull it, as it sees it from the point (\`vsmFacesAwayFromLocal\`); its energy a catcher's is the
 *  form factor with no normal (\`rectWindowed\`). */
const rectShadeRead = (out: Out, cut: LightCut) => `
 let toward=light.positionRange.xyz-P;
 let back=${cut.thin ? 'thinSurface()&&dot(N,toward)<0.0' : 'false'};
 let facing=back${cut.models ? `||surfaceModel==${MODEL_FLAG.toon}u||surfaceModel==${MODEL_FLAG.shadow}u${FACING_MODELS}` : ''}||!vsmFacesAwayFromLocal(toward,N,length(light.shape.xyz));${shadeRead(out, 'select(N,-N,back)', 'facing', 'rectWindowed(r)', cut)}`

const shadeStatement = (out: Out, cut: LightCut) => `
 // A surface facing away from the light gets its exact zero whatever the shadow: the shadow's
 // trace is skipped (\`shadowFactor\`). Toon bands light it, a shadow catcher reads the shadow
 // whatever its side, and a thin surface, which the light crosses from either side, whichever one
 // it is on (read at the normal turned to the light, \`back\`); a lamp of size lights a surface a
 // little past its horizon (\`lampSeen\`). The direction is unit as it comes.
 let back=${cut.thin ? 'thinSurface()&&lamp.side<0.0' : 'false'};
 let facing=${cut.thin ? 'thinSurface()||' : ''}${cut.models ? `surfaceModel==${MODEL_FLAG.toon}u||surfaceModel==${MODEL_FLAG.shadow}u${FACING_MODELS}||` : ''}lamp.side>0.0||lamp.cosine>0.0;${shadeRead(out, 'select(N,-N,back)', 'facing', 'lamp.falloff', cut)}`

/**
 * The one loop that walks a point's lights: a pixel's in full (\`sliceLighting\`; split into its
 * diffuse and specular shares, \`sliceLightingSplit\`), the lights of a
 * cell's list (\`cellSlice\`, \`listedLight\`) in increasing rank. Every walk hands the light's RANK to its term, whose first statement is the
 * one reach test (\`REACH\`, \`lightReaches\`) on the light's kind and sphere: a light out of reach
 * costs those words and a compare, in every program, before the rest of its record is read.
 */
export const sliceLightingWgsl = (term: 'surface' | 'split' = 'surface', models = false) =>
  wgslBlock(
    `sliceLightingWgsl(${term}${models ? ', models' : ''})`,
    models ? [SHADING_MODEL_LIGHT_WGSL] : [],
    term === 'split'
      ? `
fn sliceLightingSplit(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->LightSplit{
 var result=LightSplit(vec3f(0.0),vec3f(0.0));
 let shading=lobeSurface(rgb,metal,rough,N,V);lobeView(shading);
 for(var index=0u;index<slice.y;index++){
  let l=declaredLightSplit(listedLight(slice,index),rgb,metal,rough,N,V,P,ao,shading);
  result.diffuse+=l.diffuse;
  result.specular+=l.specular;
 }
 return result;
}`
      : `
fn sliceLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,slice:vec2u)->vec3f{
 var result=vec3f(0.0);
 let shading=${models ? 'modelLobeSurface(lobeSurface(rgb,metal,rough,N,V))' : 'lobeSurface(rgb,metal,rough,N,V)'};lobeView(shading);
 for(var index=0u;index<slice.y;index++){
  result+=declaredLight(listedLight(slice,index),rgb,metal,rough,N,V,P,ao,shading);
 }
 return result;
}`,
  )
