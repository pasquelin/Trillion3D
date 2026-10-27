import { MODEL_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'

/**
 * WHAT THE LIGHT TERM HOLDS OF THE SURFACE MODELS, the statements `declaredLightWgsl` (`lightLoopWgsl.ts`)
 * writes where its cut holds them (`LightCut.models`).
 *
 * The shadow catcher's (`catcherAlpha`, `../../materials/surface/surfaceModel.ts`): of a light that holds a
 * shadow slot, the light's energy at the point (`energy`: a lamp's falloff, a rectangle's form
 * factor with no normal) that its shadow lets through in `x`, and all of it in `y`; of any other
 * light, nothing. A program with no shadow code has no shadowed light: its terms are zero (`CATCHER_NONE`).
 *
 * The shading models a graph picks per pixel (`shadingModelWgsl.ts`): a pixel of one — skin, hair,
 * eye — takes the light from any side, so its shadow is read whichever side of its normal the light is on
 * (`FACING_MODELS`), and its model's term joins the thin transmission's (`transmitted`), before the light's
 * colour and share multiply it; a hair gives that term alone (`hairOnly`). The split term of the
 * translucent layers holds none: none of its pixels wears a model.
 */

/** A term's return of `v`: a light's whole term, or a split term's specular share. */
export type Out = (v: string) => string

export const CATCHER_SHADOWED = (out: Out, energy: string) => `
 if(surfaceModel==${MODEL_FLAG.shadow}u){
  let weight=select(0.0,lightStrength(light)*${energy},i32(light.params.y)>=0);
  return ${out('vec3f(weight*shade,weight,0.0)')};
 }`
export const CATCHER_NONE = (out: Out) => `
 if(surfaceModel==${MODEL_FLAG.shadow}u){return ${out('vec3f(0.0)')};}`

/** The facing test's operand: a pixel of a model reads the shadow of a light behind it. */
export const FACING_MODELS = '||pixelModel!=0u'

/** A lamp's model term (`modelTransmission`), toward the lamp's mean direction and by its cosine, times its
 *  `transmissionEnergy` (its intensity through its falloff and its transmission shadow); `terms` the
 *  light's shadow terms (`shadowTermsOf`). */
export const lampModelTerm = (models: boolean) =>
  models
    ? `
 if(pixelModel!=0u){
  var highlight=lamp.toward;
  var sine=0.0;
  if(lamp.capsule){
   let look=lampLook(light,P,N,V,lamp);
   highlight=look.toward;
   sine=saturate(look.reach*(1.0-rough*rough));
  }
  transmitted+=modelTransmission(rgb,rough,N,V,lamp.toward,highlight,lamp.cosine,sine,terms,false,transmitsLight(light),ao)*transmissionEnergy;
 }`
    : ''

/** A rectangle's model term, toward its centre and by the cosine of the normal with it, by its form factor and
 *  the light's colour; `terms` as the lamp's. */
export const rectModelTerm = (models: boolean) =>
  models
    ? `
  if(pixelModel!=0u){
   transmitted+=modelTransmission(rgb,rough,N,V,centre,centre,saturate(dot(N,centre)),0.0,terms,true,transmitsLight(light),ao)*(rectWindowed(r)*lightStrength(light))*light.colorIntensity.rgb;
  }`
    : ''

/** A subsurface-profile pixel's whole term from a light — its Burley diffuse, weighed by `surface`, and its
 *  transmission (`transmitted`, from a light that transmits), weighed by `transmission`, on the diffuse share and
 *  its two lobes on the specular one (`profileLampLight`, `profileRectLight`), weighed by the light's
 *  shares and `surface` — and the luminance of its diffuse light, which the scattering spreads
 *  (`scatterAdd`); the eye's diffuse light (its model's term, `transmitted`) too. `call` is the lamp's or
 *  the rectangle's, before the term of the shares. */
export const scattered = (
  surface: string,
  transmission: string,
  call: string,
) => `if(pixelModel==${PIXEL_MODEL.profile}u){
  let p=${call};
  let diffuse=(p[0]*${surface}+transmitted*${transmission})*share.x;
  scatterAdd(diffuse);
  return diffuse+p[1]*share.y*${surface};
 }
 if(pixelModel==${PIXEL_MODEL.eye}u){scatterAdd(transmitted*share.x*${transmission});}`

/** The return of a hair's term alone, `give` the light's weight on it: a hair has neither diffuse nor
 *  specular lobe. */
export const hairOnly = (give: string) => `if(pixelModel==${PIXEL_MODEL.hair}u){return ${give};}`
