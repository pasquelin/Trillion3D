/**
 * THE INDIRECT LIGHT, A PASS OVER THE TILES OF THE LIT SURFACES (`tileClass.ts`), added to the
 * lit image after the direct lights: the environment's diffuse light and the sky light's, the
 * light the probes bounced (the bounce program's), the reflection the trace wrote, a thin surface's
 * back — each under the coat the surface wears, the ambient occlusion applied as the view says —,
 * the sum `litSurface` makes of them with no light and no emission of its own. The program of a class
 * holds what its pixels need (`CLASS_CUTS`).
 */
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { lambertDiffuse } from '../../../../math/src/wgsl/lighting.ts'
import { skyLightReadWgsl } from '../../modules/sky/skyLight/read.ts'
import { skyLightOcclusionWgsl } from '../../modules/sky/skyLight/occlusionWgsl.ts'
import { SURFACE_MODEL_LIGHT_WGSL } from '../../materials/surface/surfaceModel.ts'
import { scattersPixelModel } from '../../materials/surface/pixelModel.ts'
import { SKY_DIFFUSE_READ_WGSL } from '../atmosphere/skyReadWgsl.ts'
import { BOUNCE_APPLY_WGSL } from '../bounce/applyWgsl.ts'
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
import {
  RESOLVED_INDIRECT_WGSL,
  resolvedReflectionOccludedWgsl,
  resolvedReflectionWgsl,
} from '../reflections/weight.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { AMBIENT_OCCLUSION_READ_WGSL, AMBIENT_OCCLUSION_STATEMENT } from './ambientOcclusionWgsl.ts'
import { DEFERRED_BINDINGS, DEFERRED_SKY_LIGHT_BINDINGS } from './bindings.ts'
import {
  CLASS_CUTS,
  LIT_PIXEL_WGSL,
  SUBSURFACE_BINDING_WGSL,
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
 *  thin surface's back (`thinBack`) — zero; the sky light's diffuse is the environment's, the
 *  sky nothing hides (`environmentSky`). */
const NO_BOUNCE_WGSL = wgslBlock(
  'NO_BOUNCE_WGSL',
  [SKY_DIFFUSE_READ_WGSL],
  `fn indirectIrradiance(P:vec3f,N:vec3f)->vec3f{return vec3f(0.0);}
fn environmentSky(N:vec3f)->vec3f{return skyIrradiance(N);}`,
)

/**
 * THE SKY LIGHT UNDER THE DISTANCE-FIELD OCCLUSION, the variant of the pass that holds its code
 * (`skyShadowing`): the pixel's bent normal read once (`dfaoBentNormal`), the sky light's diffuse
 * light read along it and scaled by the visibility it gives (`skyLightVisibility`) beside the
 * scene's own environment, which keeps its occlusion, and the specular occlusion of the sky's
 * reflection (`skyLightSpecularOcclusion`).
 */
const SKY_SHADOWING_WGSL = wgslBlock(
  'SKY_SHADOWING_WGSL',
  [
    lambertDiffuse,
    PI,
    dfaoReadWgsl(0, DEFERRED_BINDINGS.dfaoBent, DEFERRED_BINDINGS.dfaoRead),
    skyLightOcclusionWgsl(DEFERRED_SKY_LIGHT_BINDINGS),
    resolvedReflectionOccludedWgsl,
  ],
  `fn environmentLightingOccluded(rgb:vec3f,metal:f32,N:vec3f,ao:f32,sky:SkyVisibility)->vec3f{
 let d=clothDiffuse(rgb,metal);
 return lambertDiffuse(d.rgb,d.w,environmentIrradiance(N),ao)+lambertDiffuse(d.rgb,d.w,PI*skyLightDiffuseOccluded(sky),1.0);
}`,
)
/** The statements that read the pixel's bent normal and give the two occlusions, after the ambient
 *  occlusion (`occlusion`) the pixel is under: the bent normal only where the image applies one, else
 *  the normal. */
const SKY_SHADOWING_STATEMENTS = `var skyBent=N;
 if(skyLight.mode.y>0.0){skyBent=dfaoApplyBentNormal(dfaoBentNormal(pixel.xy,z),N);}
 let skyVis=skyLightVisibility(N,occlusion.sky,skyBent);
 let skySpec=skyLightSpecularOcclusion(skyBent,reflect(-V,N),normal.a,thinSurface());`

/** The back of a thin surface the screen probes read (`thinBack`), where they answered and the view's mode is their
 *  light: their irradiance at its back, zero staying zero — a back they found black is black —; a level that gathers
 *  no light there (`screenBackGathered`) leaves the probes' front irradiance under the occlusions the front takes
 *  (`screenMaterial`, `screenOcclusion`), which the subsurface colour joins the front diffuse by (alpha 2). */
const THIN_SCREEN_BACK_STATEMENT = `if(thinSurface()){
  let words=screenWordsAt(coord);
  if(words.w!=0u&&!screenOcclusionOnly()){
   if(screenBackGathered()){thinScreenBack=vec4f(screenBackAt(coord),1.0);}
   else{thinScreenBack=vec4f(unpackLight(words.x)*screenMaterial(albedo,base.a,occlusion.sky)*screenOcclusion(albedo,base.a,screenOcclusionOf(words)),2.0);}
  }
 }`

/** The indirect light a program adds, its bounce and its reflection a column each: the bounce
 *  program's gathers the probes once for both (`resolvedIndirect`); the program without bounce adds none,
 *  and the reflection as the trace wrote it, or, in the variant that applies the sky light's
 *  occlusion, under it (`resolvedReflectionOccluded`). */
const INDIRECT_TERMS = {
  bounce: 'resolvedIndirect(coord,albedo,base.a,normal.a,N,V,P,occlusion.sky,occlusion.both)',
  direct: 'mat2x3f(vec3f(0.0),resolvedReflection(coord,occlusion.both,N,V,normal.a))',
  skyShadowed:
    'mat2x3f(vec3f(0.0),resolvedReflectionOccluded(coord,base.rgb,base.a,occlusion.both,N,V,normal.a,skySpec.specular,skySpec.add))',
}

type ClassCut = (typeof CLASS_CUTS)[TileClass]

/** The modules the pass is made of, for the cuts of its class. */
function indirectModules(bounce: boolean, skyShadowing: boolean, cut: ClassCut) {
  return [
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
    THIN_SURFACE_WGSL,
    ENVIRONMENT_LIGHTING_WGSL,
    VOLUMETRIC_LIGHT_READ_WGSL,
    ...(bounce
      ? [BOUNCE_APPLY_WGSL, RESOLVED_INDIRECT_WGSL]
      : [NO_BOUNCE_WGSL, resolvedReflectionWgsl]),
    ...(skyShadowing ? [SKY_SHADOWING_WGSL] : []),
    AMBIENT_OCCLUSION_READ_WGSL,
    LIT_PIXEL_WGSL,
    TILE_VERTEX_WGSL,
    ...(cut.thin ? [SUBSURFACE_BINDING_WGSL] : []),
  ]
}

/** The entry `indirectMain`. */
function indirectMainWgsl(bounce: boolean, skyShadowing: boolean, cut: ClassCut) {
  const terms = bounce
    ? INDIRECT_TERMS.bounce
    : skyShadowing
      ? INDIRECT_TERMS.skyShadowed
      : INDIRECT_TERMS.direct
  const environment = skyShadowing
    ? 'environmentLightingOccluded(albedo,base.a,N,occlusion.sky,skyVis)'
    : 'environmentLighting(albedo,base.a,N,occlusion.sky)'
  const lightmap = 'volumetricLightmapLighting(coord,albedo,base.a,occlusion.sky)'
  return `
@fragment fn indirectMain(@builtin(position) pixel:vec4f)->@location(0) vec4f{${litPixelStatements(cut)}${
    bounce
      ? `
 if(lightView==4u){return vec4f(bounceIrradiance(coord,N,P,view.lightParams.w),0.0);}`
      : ''
  }
 ${AMBIENT_OCCLUSION_STATEMENT}${skyShadowing ? `\n ${SKY_SHADOWING_STATEMENTS}` : ''}${
   bounce && cut.thin
     ? `
 ${THIN_SCREEN_BACK_STATEMENT}`
     : ''
 }
 let indirect=${terms};
 if(lightView==1u){return vec4f(preExposed(indirect[1]),0.0);}
 let bounceLight=indirect[0]*occlusion.bounce;
 let ambientLight=${environment}+${lightmap};${
   cut.models
     ? `
 if(${scattersPixelModel('pixelModelId')}){scatterAdd(bounceLight+ambientLight);}`
     : ''
 }
 let rgb=litSurface(vec3f(0.0),bounceLight,ambientLight,indirect[1],vec3f(0.0),N,P,occlusion.sky);
 return lightOut(rgb,lightView);
}`
}

/**
 * The indirect pass for the tiles of `tileClass`: the entry `indirectMain`, which adds the
 * pre-exposed indirect light to the pixel. With `bounce`, the probes' light (the bounce program;
 * its view of the irradiance alone, `lightView` 4, shows the bounce as the harness measures it);
 * with `skyShadowing`, the sky light under the distance fields' occlusion — the bounce program has
 * none, its probes carry the sky. A view of the lit image shows one term in its place: 1 the
 * reflection alone.
 */
export function indirectPassWgsl({
  bounce,
  skyShadowing,
  tileClass,
}: {
  bounce: boolean
  skyShadowing: boolean
  tileClass: TileClass
}) {
  if (bounce && skyShadowing) throw new Error('the bounce program has no sky shadowing')
  const cut = CLASS_CUTS[tileClass]
  return wgslBlock(
    `indirectPassWgsl(${bounce}, ${skyShadowing}, ${tileClass})`,
    indirectModules(bounce, skyShadowing, cut),
    indirectMainWgsl(bounce, skyShadowing, cut),
  )
}
