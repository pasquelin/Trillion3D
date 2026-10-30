import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { INVERSE_PI } from '../../../../math/src/wgsl/constants.ts'
import { luminance } from '../../../../math/src/wgsl/color.ts'
import { ndotvClamped, slabF90 } from '../../../../math/src/wgsl/lighting.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../materials/surface/surfaceEmission.ts'
import { MODEL_SWITCH, PIXEL_MODEL, pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { SUBSURFACE_TARGET } from '../../materials/surface/subsurface.ts'
import { SURFACE_F0_WGSL, specularOfFlags } from '../../materials/surface/surfaceSpecular.ts'
import { DEFERRED_BINDINGS, DEFERRED_TOON_TABLES } from '../deferred/bindings.ts'
import { directLightWgsl } from '../direct/lightWgsl.ts'
import { ENERGY_TERMS_WGSL } from '../direct/energyTermsWgsl.ts'
import { PROFILE_LIGHT_WGSL } from '../direct/profileModelWgsl.ts'
import { TOON_APPLY_WGSL } from '../direct/toonModelWgsl.ts'
import { SHADING_MODEL_LIGHT_WGSL, SHADING_MODEL_PIXEL_WGSL } from '../direct/shadingModelWgsl.ts'
import { toonTablesBinding } from '../toon/tablesWgsl.ts'

/**
 * The bindings of the trace's group 0 that carry the pixel's shading model: the base colour and metalness (read for the diffuse colour the light is
 * divided by), the light buffer (its skin table and profile rows), the material's occlusion. The thin transmission's target and the toon buffer are
 * at the numbers the lit passes give them (`DEFERRED_BINDINGS.subsurface`, `DEFERRED_BINDINGS.toonTables`), and the dag's tables at 1, 6, 7 and 9.
 */
export const SKY_MODEL_BINDINGS = {
  base: 12,
  lights: 13,
  emissiveAo: 14,
  subsurface: DEFERRED_BINDINGS.subsurface,
  toon: DEFERRED_BINDINGS.toonTables,
} as const

const { hair, eye, toon, profile, skin } = PIXEL_MODEL

/**
 * THE DIFFUSE COLOUR THE TRACED LIGHT IS DIVIDED BY, and the denoised light is multiplied by again (`skyAlbedo`): the base colour less what its metalness spends of it; a hair and an eye keep their whole
 * colour, the metalness they store being a scatter amount and an iris distance, not a metal's (`setPixelModel`). The trace and the composite read it from the same text.
 */
export const SKY_ALBEDO_WGSL = wgslBlock(
  'SKY_ALBEDO_WGSL',
  [pixelModelOf],
  `fn skyAlbedo(base:vec4f,word:u32)->vec3f{
 let model=pixelModelOf(word);
 return select(base.rgb*(1.0-base.a),base.rgb,model==${hair}u||model==${eye}u);
}`,
)

/**
 * THE PIXEL'S SHADING MODEL IN THE TRACE: the bindings it reads and the two functions the trace calls.
 * - `skyModelSet`, once a pixel: the pixel's model set from its flags, the thin transmission's texel and its base (`setPixelModel`), as a lit pass sets it; it gives back the base the pixel is lit with.
 * - `skyModelThroughput`, for each ray that reaches the sky: the diffuse of the pixel's model toward the direction `L` of cosine `NoL`, the colour of the surface in it. A hair is its fibre's scattering
 *   (`hairShading` with no shadow, no backlit and the plain transmittance); an eye has no diffuse of its own, its term is its transmission; a toon pixel's is its closure's diffuse with every shadow term nil
 *   (`toonShade`: the ramp read at the signed cosine); a subsurface profile's is the Burley diffuse (`profileBurley`); every other model is the Lambert diffuse of its colour times the cosine. The diffuse of the
 *   default, subsurface and profile models is weighed by what their specular lobe leaves (`skyKeep`: one minus the luminance of its energy, the profile's two lobes at their mean roughness). Where `transmission` is on, the model's transmission toward `L` is added (`modelTransmission`: the thin
 *   subsurface's, the skin's, the eye's, the hair's), unshadowed, with `ao` the material's occlusion; a subsurface profile's transmission is the lights', none for the sky.
 */
export const SKY_MODEL_WGSL = wgslBlock(
  'SKY_LIGHT_MODEL_WGSL',
  [
    SHADING_MODEL_LIGHT_WGSL,
    SHADING_MODEL_PIXEL_WGSL,
    directLightWgsl(),
    toonTablesBinding(DEFERRED_TOON_TABLES),
    SURFACE_EMISSIVE_AO_WGSL,
    specularOfFlags,
    SKY_ALBEDO_WGSL,
    INVERSE_PI,
    ENERGY_TERMS_WGSL,
    PROFILE_LIGHT_WGSL,
    TOON_APPLY_WGSL,
    luminance,
    slabF90,
    ndotvClamped,
    SURFACE_F0_WGSL,
  ],
  `@group(0) @binding(${SKY_MODEL_BINDINGS.base}) var baseMetal:texture_2d<f32>;
@group(0) @binding(${SKY_MODEL_BINDINGS.lights}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${SKY_MODEL_BINDINGS.emissiveAo}) var emissiveAo:texture_2d<f32>;
${SUBSURFACE_TARGET.wgsl}
fn skyModelHair(word:u32)->bool{return pixelModelOf(word)==${hair}u;}
fn skyModelSet(word:u32,at:vec2i,base:vec4f,N:vec3f,V:vec3f,rough:f32)->vec4f{
 surfaceSpecular=specularOfFlags(word);
 modelTransmitDistance=view.preExposure.w;
 let model=pixelModelOf(word);
 if(model==0u){return base;}
 return setPixelModel(model,textureLoad(subsurfaceColor,at),base,N,V,rough,(u32(view.views.w)&${MODEL_SWITCH.irisNormal}u)!=0u);
}
// What the specular lobe of reflectance f0 leaves of the light for the diffuse under it: one minus the luminance of the lobe's energy (energyTerms, the table of the light buffer) at the roughness rough and the view cosine NoV.
fn skyKeep(f0:vec3f,rough:f32,NoV:f32)->f32{
 return 1.0-luminance(energyTerms(f0,slabF90(f0),rough,NoV));
}
fn skyModelThroughput(albedo:vec3f,lit:vec4f,rough:f32,N:vec3f,V:vec3f,L:vec3f,facing:f32,ao:f32,transmission:bool)->vec3f{
 if(pixelModel==${hair}u){
  return hairShading(lit.rgb,rough,surfaceSpecular,modelScatter,1.0,L,V,N,0.0,hairTransmittanceInit(false,true),0.0,0.0);
 }
 let NoL=saturate(facing);
 var through=vec3f(0.0);
 if(pixelModel==${toon}u){
  // The closure with no shadow at all (the light's terms are nil): the diffuse ramp read at the remapped signed cosine, a shadow nil unless the ramp holds it.
  var surface:LobeSurface;
  surface.diffuse=albedo*INVERSE_PI;
  through=toonShade(surface,0.0,facing,NoL,1.0,0.0,0.0).diffuse;
 }else if(pixelModel==${profile}u){
  // The Burley diffuse under the energy the profile's two specular lobes (their mean roughness) take.
  let surface=lobeSurface(lit.rgb,lit.a,rough,N,V);
  let dual=profileLobesOf(rough);
  through=profileBurley(surface,rough,NoL,profileVoH(dot(V,L)))*(NoL*skyKeep(surface.f0,mix(dual.x,dual.y,dual.z),surface.NdotV));
 }else if(pixelModel!=${eye}u){
  through=albedo*(NoL*INVERSE_PI);
  if(pixelModel!=${skin}u){through*=skyKeep(surfaceF0(lit.rgb,lit.a),rough,ndotvClamped(N,V));}
 }
 if(transmission){through+=modelTransmission(albedo,rough,N,V,L,L,NoL,0.0,ShadowTerms(0.0,0.0,0.0),false,false,ao);}
 return through;
}`,
)
