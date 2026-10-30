/**
 * THE INDIRECT LIGHT, A PASS OVER THE TILES OF THE LIT SURFACES (`tileClass.ts`), added to the
 * lit image after the direct lights: the environment's diffuse light and the sky light's, the
 * light the probes bounced (the bounce program's), the reflection the trace wrote, a thin surface's
 * back — each under the coat the surface wears, the ambient occlusion applied as the view says —,
 * the sum `litSurface` makes of them with no light and no emission of its own. The program of a class
 * holds what its pixels need (`CLASS_CUTS`).
 */
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'
import { skyLightReadWgsl } from '../../modules/sky/skyLight/read.ts'
import {
  skyLightDiffuseOcclusionWgsl,
  skyLightOcclusionWgsl,
} from '../../modules/sky/skyLight/occlusionWgsl.ts'
import { SURFACE_MODEL_LIGHT_WGSL } from '../../materials/surface/surfaceModel.ts'
import { scattersPixelModel } from '../../materials/surface/pixelModel.ts'
import { SKY_DIFFUSE_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'
import { BOUNCE_APPLY_WGSL } from '../bounce/applyWgsl.ts'
import { screenFoliageStatement } from '../bounce/screen/indirectWgsl.ts'
import { dfaoReadWgsl } from '../distanceField/ao/readWgsl.ts'
import { directLightWgsl } from '../direct/lightWgsl.ts'
import { ENVIRONMENT_LIGHTING_WGSL, THIN_SURFACE_WGSL } from '../direct/lightingWgsl.ts'
import {
  LOBELESS_LIGHTING_WGSL,
  LOBELESS_MODELS_LIGHTING_WGSL,
  LOBES_LIGHTING_WGSL,
  LOBES_TARGET_WGSL,
} from '../direct/lobesWgsl.ts'
import { reflectionLobeWgsl } from '../lobeAxisWgsl.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'
import {
  NO_LOCAL_LIGHT_WGSL,
  reflectionResolveWgsl,
  reflectionWeighWgsl,
} from '../reflections/weight.ts'
import { capturedLocalLightWgsl } from '../reflectionCapture/localLightWgsl.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { TOON_TABLES_NONE_WGSL, toonTablesBinding } from '../toon/tablesWgsl.ts'
import { ambientCubemapWgsl } from './ambientCubemapWgsl.ts'
import { AMBIENT_OCCLUSION_READ_WGSL, AMBIENT_OCCLUSION_STATEMENT } from './ambientOcclusionWgsl.ts'
import {
  DEFERRED_BINDINGS,
  DEFERRED_CAPTURE_BINDINGS,
  DEFERRED_SKY_LIGHT_BINDINGS,
  DEFERRED_TOON_TABLES,
} from './bindings.ts'
import {
  CLASS_CUTS,
  LIT_PIXEL_WGSL,
  SUBSURFACE_BINDING_WGSL,
  type LitPixelCut,
  litPixelStatements,
} from './litSurfaceWgsl.ts'
import { TILE_VERTEX_WGSL } from './tilePass.ts'
import type { TileClass } from './tileClass.ts'

/** The light buffer: the environment's light, the sky's and the fog's blocks. */
const LIGHTS_BINDING_WGSL = wgslBlock(
  'INDIRECT_LIGHTS_BINDING_WGSL',
  [directLightWgsl()],
  `@group(0) @binding(${DEFERRED_BINDINGS.lights}) var<storage,read> directLights:DirectLights;`,
)

/**
 * The light the volumetric lightmap gives the pixel (`volumetricLightWgsl.ts`, the pass that gathers
 * it): its irradiance along the pixel's normal lights the pixel's diffuse colour — a cloth's fuzz
 * joined to it, `clothDiffuse` — under the occlusion `ao`, as the environment's does; nothing where
 * the pass left none.
 */
const VOLUMETRIC_LIGHT_READ_WGSL = wgslBlock(
  'VOLUMETRIC_LIGHT_READ_WGSL',
  [lambertDiffuse],
  `@group(0) @binding(${DEFERRED_BINDINGS.volumetricLight}) var volumetricLight:texture_2d<f32>;
fn volumetricLightmapLighting(coord:vec2i,rgb:vec3f,metal:f32,ao:f32)->vec3f{
 let seen=textureLoad(volumetricLight,coord,0);
 if(seen.a==0.0){return vec3f(0.0);}
 let d=clothDiffuse(rgb,metal);
 return lambertDiffuse(d.rgb,d.w,seen.rgb,ao);
}`,
)

/** No bounced light: what a program without the probes answers where the lighting samples it — a
 *  thin surface's back (`thinBack`) — zero; the sky light's diffuse is the environment's
 *  (`environmentSky`): the sky light's diffuse under the visibility and tint of a pixel whose bent normal is its normal
 *  (`skyLightVisibility`), the occlusion `ao` of the others its only occlusion — the one function the program that reads the
 *  distance fields' occlusion applies (`skyShadowingWgsl`) with the sky shadowing's term 1. */
const NO_BOUNCE_WGSL = wgslBlock(
  'NO_BOUNCE_WGSL',
  [SKY_DIFFUSE_READ_WGSL, skyLightDiffuseOcclusionWgsl(DEFERRED_SKY_LIGHT_BINDINGS), PI],
  `fn indirectIrradiance(P:vec3f,N:vec3f)->vec3f{return vec3f(0.0);}
fn environmentSky(N:vec3f,ao:f32)->vec3f{return PI*skyLightDiffuseOccluded(skyLightVisibility(N,ao,N));}`,
)

/**
 * THE SKY LIGHT UNDER THE DISTANCE-FIELD OCCLUSION, the variant of the pass that holds its code
 * (`skyShadowing`): the pixel's bent normal read once (`dfaoBentNormal`), the sky light's diffuse
 * light read along it and scaled by the visibility it gives (`skyLightVisibility`) beside the
 * scene's own environment, which keeps its occlusion, and the specular occlusion of the sky's
 * reflection (`skyLightSpecularOcclusion`).
 */
const skyShadowingWgsl = (occluded: WgslDecl) =>
  wgslBlock(
    `SKY_SHADOWING_WGSL(${occluded.name})`,
    [
      PI,
      dfaoReadWgsl(0, DEFERRED_BINDINGS.dfaoBent, DEFERRED_BINDINGS.dfaoRead),
      skyLightOcclusionWgsl(DEFERRED_SKY_LIGHT_BINDINGS),
      occluded,
    ],
    `fn environmentLightingOccluded(rgb:vec3f,metal:f32,N:vec3f,ao:f32,sky:SkyVisibility)->vec3f{
 return environmentLightingWith(rgb,metal,N,ao,PI*skyLightDiffuseOccluded(sky));
}`,
  )
/**
 * THE INDIRECT CAPSULE SHADOWS, the variant of the pass that holds their code (`capsule`): the factor the capsules of the objects that cast them let the
 * indirect light through at a pixel, read once (`capsuleIndirectAt`) and multiplied into the bounce, the environment's light and the reflection — the indirect
 * light alone, not the direct lights'. The buffer's first word is a row's bytes, its pixels begin at byte 256; a row of no bytes is no shadow.
 */
const CAPSULE_INDIRECT_WGSL = wgslBlock(
  'CAPSULE_INDIRECT_WGSL',
  [],
  `@group(0) @binding(${DEFERRED_BINDINGS.capsuleIndirect}) var<storage,read> capsuleIndirect:array<u32>;
fn capsuleIndirectAt(coord:vec2i)->f32{
 let row=capsuleIndirect[0];
 if(row==0u){return 1.0;}
 let at=256u+u32(coord.y)*row+u32(coord.x);
 return f32((capsuleIndirect[at>>2u]>>((at&3u)*8u))&255u)/255.0;
}`,
)

/** The statements that read the pixel's bent normal and give the occlusions, after the ambient
 *  occlusion (`occlusion`) the pixel is under: the bent normal only where the image applies one, else
 *  the normal. The sky's specular occlusion is the base lobe's (`skySpec`, along the reflection about the normal, at the
 *  surface's roughness); in a program that holds the lobes, a pixel with a clear coat has the coat's own (`skyCoat`, along
 *  the reflection about the coat's top normal, at the coat's roughness): its `specular` and `add` are another pair than
 *  the base lobe's, for the coat's rough light to take. Where the pixel has no coat, and in a program without the lobes,
 *  `skyCoat` is the base lobe's. */
const skyShadowingStatements = (lobes: boolean) => `var skyBent=N;
 if(skyLight.mode.y>0.0){skyBent=dfaoApplyBentNormal(dfaoBentNormal(pixel.xy,z),N);}
 let skyVis=skyLightVisibility(N,occlusion.sky,skyBent);
 let skySpec=skyLightSpecularOcclusion(skyBent,reflect(-V,N),normal.a,thinSurface());${
   lobes
     ? `
 var skyCoat=skySpec;
 if(hasCoat()){skyCoat=skyLightSpecularOcclusion(skyBent,reflect(-V,lobes.coatN),lobes.coatRough,thinSurface());}`
     : `
 let skyCoat=skySpec;`
 }`

/** Whether the program lights the sky itself for a thin two-sided surface with the visibility of the pixel's normal: the one visibility its front and its back share (`skyVis`), computed once. */
const sharesPlainVisibility = (bounce: boolean, skyShadowing: boolean, cut: LitPixelCut) =>
  !bounce && !skyShadowing && cut.thin

/** The sky light along the back of a thin two-sided surface (`thinSkyBack`), in the program that lights the sky itself (the bounce program's probes carry the sky): under the visibility the
 *  front takes, the one `skyVis` of the variant that applies the distance fields' occlusion, else that of the pixel's normal as its bent normal, made here (`sharesPlainVisibility`). */
const thinSkyBackStatement = (bounce: boolean, skyShadowing: boolean, cut: LitPixelCut) =>
  bounce || !cut.thin
    ? ''
    : `${sharesPlainVisibility(bounce, skyShadowing, cut) ? '\n let skyVis=skyLightVisibility(N,occlusion.sky,N);' : ''}\n thinSkyBack=skyLightBackOccluded(skyVis,N);`

/** The back of a thin surface the screen probes read (`thinBack`), where they answered and the view's mode is their
 *  light: their irradiance at its back under the short-range occlusion the front takes (`screenOcclusion`), zero staying zero — a back they
 *  found black is black —; a level that gathers
 *  no light there (`screenBackGathered`) leaves the probes' front irradiance, the material's occlusion already in it,
 *  under the same occlusion, which the subsurface colour joins the front
 *  diffuse by (alpha 2). */
const THIN_SCREEN_BACK_STATEMENT = `if(thinSurface()){
  let words=screenWordsAt(coord);
  if(words.w!=0u&&!screenOcclusionOnly()){
   let occluded=screenOcclusion(albedo,screenOcclusionOf(words),foliage);
   if(screenBackGathered()){thinScreenBack=vec4f(screenBackAt(coord)*occluded,1.0);}
   else{thinScreenBack=vec4f(unpackLight(words.x)*occluded,2.0);}
  }
 }`

/** The indirect light a program adds, its bounce and its reflection a column each: the bounce
 *  program's gathers the probes once for both (`resolvedIndirect`); the program without bounce adds none,
 *  and the reflection as the trace wrote it, or, in the variant that applies the sky light's
 *  occlusion, under it (`resolvedReflectionOccluded`). */
const INDIRECT_TERMS = {
  bounce:
    'resolvedIndirect(coord,albedo,base.a,normal.a,N,V,P,occlusion.sky,occlusion.both,foliage)',
  direct:
    'mat2x3f(vec3f(0.0),resolvedReflection(coord,base.rgb,base.a,occlusion.both,N,V,normal.a))',
  skyShadowed:
    'mat2x3f(vec3f(0.0),resolvedReflectionOccluded(coord,base.rgb,base.a,occlusion.both,N,V,normal.a,skySpec.specular,skySpec.add,skyCoat.specular,skyCoat.add))',
}

/** The modules the pass is made of, for the cuts of its class. */
export function indirectModules(
  bounce: boolean,
  skyShadowing: boolean,
  cubed: boolean,
  cut: LitPixelCut,
  capsule = false,
  captured = false,
) {
  const resolve = reflectionResolveWgsl(
    captured ? capturedLocalLightWgsl(DEFERRED_CAPTURE_BINDINGS) : NO_LOCAL_LIGHT_WGSL,
  )
  return [
    cut.models ? toonTablesBinding(DEFERRED_TOON_TABLES) : TOON_TABLES_NONE_WGSL,
    STANDARD_LIGHTING_WGSL,
    LIGHTS_BINDING_WGSL,
    skyLightReadWgsl(DEFERRED_SKY_LIGHT_BINDINGS),
    SURFACE_MODEL_LIGHT_WGSL,
    cut.lobes
      ? LOBES_LIGHTING_WGSL
      : cut.models
        ? LOBELESS_MODELS_LIGHTING_WGSL
        : LOBELESS_LIGHTING_WGSL,
    ...(cut.lobes ? [LOBES_TARGET_WGSL] : []),
    reflectionLobeWgsl(cut.lobes),
    reflectionWeighWgsl(cut.lobes),
    THIN_SURFACE_WGSL,
    ENVIRONMENT_LIGHTING_WGSL,
    VOLUMETRIC_LIGHT_READ_WGSL,
    ...(bounce
      ? [BOUNCE_APPLY_WGSL, resolve.RESOLVED_INDIRECT_WGSL]
      : [NO_BOUNCE_WGSL, resolve.resolvedReflectionWgsl]),
    ...(skyShadowing ? [skyShadowingWgsl(resolve.resolvedReflectionOccludedWgsl)] : []),
    ...(capsule ? [CAPSULE_INDIRECT_WGSL] : []),
    ...(cubed ? [ambientCubemapWgsl(cut.lobes)] : []),
    AMBIENT_OCCLUSION_READ_WGSL,
    LIT_PIXEL_WGSL,
    TILE_VERTEX_WGSL,
    ...(cut.thin ? [SUBSURFACE_BINDING_WGSL] : []),
  ]
}

/** The entry `indirectMain`. */
function indirectMainWgsl(
  bounce: boolean,
  skyShadowing: boolean,
  cubed: boolean,
  cut: LitPixelCut,
  capsule: boolean,
  captured: boolean,
) {
  const terms = bounce
    ? INDIRECT_TERMS.bounce
    : skyShadowing
      ? INDIRECT_TERMS.skyShadowed
      : INDIRECT_TERMS.direct
  const sky = skyShadowing
    ? 'environmentLightingOccluded(albedo,base.a,N,occlusion.sky,skyVis)'
    : sharesPlainVisibility(bounce, skyShadowing, cut)
      ? 'environmentLightingWith(albedo,base.a,N,occlusion.sky,PI*skyLightDiffuseOccluded(skyVis))'
      : 'environmentLighting(albedo,base.a,N,occlusion.sky)'
  const environment = captured ? `capturedAmbient(${sky},albedo,base.a,N,occlusion.both)` : sky
  const lightmap = 'volumetricLightmapLighting(coord,albedo,base.a,occlusion.sky)'
  const reflection = cubed ? '(indirect[1]+cube[1])' : 'indirect[1]'
  return `
@fragment fn indirectMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}${
    captured
      ? `
 capturePoint=P;`
      : ''
  }${
    bounce
      ? `
 if(lightView==4u){return vec4f(bounceIrradiance(coord,N,P,view.lightParams.w),0.0);}
 ${screenFoliageStatement(cut)}`
      : ''
  }
 ${AMBIENT_OCCLUSION_STATEMENT}${capsule ? '\n let capsuleFactor=capsuleIndirectAt(coord);' : ''}${skyShadowing ? `\n ${skyShadowingStatements(cut.lobes)}` : ''}${thinSkyBackStatement(bounce, skyShadowing, cut)}${
   bounce && cut.thin
     ? `
 ${THIN_SCREEN_BACK_STATEMENT}`
     : ''
 }
 let indirect=${terms};${
   cubed
     ? `
 let cube=ambientCubemapAt(albedo,base.a,normal.a,N,V,occlusion.both);
 thinCubeBack=ambientCubemapBack(N,thinScreenBack.a==2.0);`
     : ''
 }
 if(lightView==1u){return vec4f(preExposed(${reflection}${capsule ? '*capsuleFactor' : ''}),0.0);}
 let bounceLight=indirect[0]*occlusion.bounce;
 let ambientLight=${environment}+${lightmap}${cubed ? '+cube[0]' : ''};${
   cut.models
     ? `
 if(${scattersPixelModel('pixelModelId')}){scatterAdd(${capsule ? '(bounceLight+ambientLight)*capsuleFactor' : 'bounceLight+ambientLight'});}`
     : ''
 }
 ${
   cut.models
     ? `var reflected=${reflection};
 if(pixelModelId==${PIXEL_MODEL.toon}u){reflected=toonIndirectSpecular(reflected);}
 `
     : ''
 }let rgb=litSurface(vec3f(0.0),bounceLight,ambientLight,${cut.models ? 'reflected' : reflection},vec3f(0.0),N,P,occlusion.sky);
 return lightOut(${capsule ? 'rgb*capsuleFactor' : 'rgb'});
}`
}

/**
 * The indirect pass for the tiles of `tileClass`: the entry `indirectMain`, which adds the
 * pre-exposed indirect light to the pixel. With `bounce`, the probes' light (the bounce program;
 * its view of the irradiance alone, `lightView` 4, shows the bounce as the harness measures it);
 * with `skyShadowing`, the sky light under the distance fields' occlusion — the bounce program has
 * none, its probes carry the sky; with `cubed`, the ambient cubemap's diffuse and specular light
 * (`ambientCubemapWgsl.ts`), added to the environment's and to the reflection; with `captured`, the reflection captures laid over the sky in the rough light of the
 * reflection and, with their diffuse light on, in the environment's diffuse light (`reflectionCapture/localLightWgsl.ts`). A view of the lit image shows one term in its place: 1 the
 * reflection alone.
 */
export function indirectPassWgsl({
  bounce,
  skyShadowing,
  cubed = false,
  capsule = false,
  captured = false,
  tileClass,
}: {
  bounce: boolean
  skyShadowing: boolean
  cubed?: boolean
  capsule?: boolean
  captured?: boolean
  tileClass: TileClass
}) {
  if (bounce && skyShadowing) throw new Error('the bounce program has no sky shadowing')
  // No light's term tests a pixel's lighting channels here: it unpacks none.
  const cut = { ...CLASS_CUTS[tileClass], channels: false }
  return wgslBlock(
    `indirectPassWgsl(${bounce}, ${skyShadowing}, ${tileClass}${cubed ? ', cube' : ''}${capsule ? ', capsule' : ''}${captured ? ', captures' : ''})`,
    indirectModules(bounce, skyShadowing, cubed, cut, capsule, captured),
    indirectMainWgsl(bounce, skyShadowing, cubed, cut, capsule, captured),
  )
}
