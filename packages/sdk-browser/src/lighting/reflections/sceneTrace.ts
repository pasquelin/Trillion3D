import { wgslBlock, wgslStruct } from '../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { REFLECTION_FATE_WGSL } from './censusWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { RADIANCE_ANSWER, REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_FIELD_WGSL, reflectionSurfaceHitWgsl } from './trace/traceBindings.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'

/** What the scene stage answers (`reflectionSceneTrace`, here and in `sceneTraceHardware.ts`): the ray's answer, and whether it left the scene. */
export const REFLECTION_SCENE_TRACE_RESULT = wgslStruct(
  'ReflectionSceneTrace',
  [RADIANCE_ANSWER],
  'struct ReflectionSceneTrace{answer:RadianceAnswer,open:bool,}',
)

/** The march's step factor, where it begins and the march itself. */
const MARCH_WGSL = `/** The factor of the march's step: drawn between \`REFLECTION_STEP_DITHER\` and its reciprocal by the pixel's noise of
 *  this image, and 1 for a ray whose cone (\`cone\`, radians) spans \`REFLECTION_STEP_DITHER_CONE\`. */
fn reflectionStepFactor(coord:vec2u,cone:f32)->f32{
 let drawn=mix(REFLECTION_STEP_DITHER,1.0/REFLECTION_STEP_DITHER,interleavedGradientNoise(vec2f(coord),f32(reflectionView.temporal.y)));
 return mix(drawn,1.0,saturate(cone/REFLECTION_STEP_DITHER_CONE));
}
/** Where the march of the ray from \`P\` along \`R\` begins, centimetres from the point the ray leaves the surface at: the
 *  screen having stopped knowing it at \`begin\` metres, less \`REFLECTION_PULLBACK\` half voxels of the clipmap that holds
 *  that point, from 0 on. */
fn reflectionMarchStart(P:vec3f,R:vec3f,begin:f32)->f32{
 let there=begin*REFLECTION_CENTIMETRES;
 let halfVoxel=gdfView.centerExtent[gdfClipmapAt(gdfTranslated(P*REFLECTION_CENTIMETRES)+R*there)].w*gdfView.texel;
 return max(there-REFLECTION_PULLBACK*halfVoxel,0.0);
}
/** The ray from \`P\` along \`R\` marched through the field from \`begin\` (\`reflectionMarchStart\`) over \`reach\` metres, from the
 *  point it leaves the surface at, \`bias\` metres along itself: the hit time in centimetres from that point, -1 where it met
 *  nothing, the clipmap and the steps taken. */
fn reflectionMarch(P:vec3f,R:vec3f,begin:f32,reach:f32,coord:vec2u,cone:f32)->GdfTraceResult{
 let start=(P+R*reflectionView.reach.x)*REFLECTION_CENTIMETRES;
 return gdfTraceRay(start,R,begin,reach*REFLECTION_CENTIMETRES,reflectionStepFactor(coord,cone),false,false,coord,0.0);
}`

/** The answer of a march that met a surface, and where the screen's far trace begins. */
const HIT_WGSL = `/** The answer of a march that met a surface at \`marched\`: the cache's light there, fogged along the ray or the lit
 *  image where it agrees (\`reflectionSeenAt\`), read with the ray's cone angle \`cone\` — a black hit at the march's distance where no card gave any light. \`bias\` is the metres the march began
 *  from \`P\` along \`R\`. */
fn reflectionHitAnswer(P:vec3f,lobe:ReflectionLobe,marched:GdfTraceResult,bias:f32,coord:vec2u,cone:f32)->RadianceAnswer{
 let spread=reflectionHitSpread(cone);
 let origin=(P+lobe.R*bias)*REFLECTION_CENTIMETRES;
 let surface=scGlobalHit(origin,lobe.R,marched,spread,false,-1.0,reflectionDone(REFLECTION_HI_RES_SURFACE),coord);
 let at=(origin+lobe.R*marched.hitTime)/REFLECTION_CENTIMETRES;
 let distanceOf=bias+marched.hitTime/REFLECTION_CENTIMETRES;
 if(!surface.valid){return RadianceAnswer(vec3f(0.0),true,distanceOf);}
 return RadianceAnswer(reflectionSeenAt(surface.radiance,at,surface.face,coord),true,distanceOf);
}
/** Where the screen's far trace of a ray from \`P\` along \`R\` begins, metres along it, \`stop\` when it has none: where the ray leaves the outermost clipmap of the
 *  field, pulled back by the share of the trace a jittered step spans. */
fn reflectionDistantStart(P:vec3f,R:vec3f,stop:f32)->f32{
 if(gdfView.clipmaps==0u){return stop;}
 return gdfClipRayOutside(gdfTranslated(P*REFLECTION_CENTIMETRES),R,stop*REFLECTION_CENTIMETRES,reflectionView.scene.y).start/REFLECTION_CENTIMETRES;
}`

/** The scene stage: the march, the hit's answer and the fate the trace's census counts. */
const STAGE_WGSL = `fn reflectionSceneTrace(P:vec3f,N:vec3f,lobe:ReflectionLobe,begin:f32,coord:vec2u,cone:f32,firstPerson:bool)->ReflectionSceneTrace{
 let none=ReflectionSceneTrace(RadianceAnswer(vec3f(0.0),false,0.0),false);
 reflectionFate=REFLECTION_FATE_NO_FIELD;
 reflectionWork=0u;
 if(gdfView.clipmaps==0u){return none;}
 let bias=reflectionView.reach.x;
 let far=reflectionFar();
 let reach=far-bias;
 // A ray the screen followed to the longest ray has nothing left to march: it leaves the scene, as a march that met nothing.
 if(reach<=max(begin-bias,0.0)){reflectionFate=REFLECTION_FATE_BOUND;return ReflectionSceneTrace(none.answer,true);}
 // With the scene traces off nothing is marched: the ray goes whole to what lies past the scene.
 var answer=RadianceAnswer(vec3f(0.0),false,far);
 var open=true;
 reflectionOrigin=P;
 if(reflectionDone(REFLECTION_SCENE_TRACES)){
  let start=reflectionMarchStart(P,lobe.R,begin);
  let marched=reflectionMarch(P,lobe.R,start,reach,coord,cone);
  reflectionWork=marched.steps;
  if(marched.hitTime>=0.0){
   // The march met a surface: the cache gives its light; one it holds none of answers nothing.
   answer=reflectionHitAnswer(P,lobe,marched,bias,coord,cone);
   open=false;
  }
 }
 reflectionFate=select(REFLECTION_FATE_OPEN,REFLECTION_FATE_HIT,answer.hit);
 return ReflectionSceneTrace(answer,open);
}`

/**
 * The scene's answer to a reflection (`reflectionSceneTrace`), where the screen did not give one: a ray marched
 * through the global distance field (`gdfTrace`, `../distanceField/globalTraceWgsl.ts`), then, where it meets a
 * surface, the light of that surface read in the surface cache's final lighting (`scGlobalHit`, `../surfaceCache/hitWgsl.ts`), or
 * the lit image where it agrees with the depth (`reflectionSeenAt`, `rayLightWgsl.ts`). One ray a call, cast this
 * image, kept nowhere, by the trace's scene stage alone (`trace/trace.ts`), over its own group's field and cache
 * (`REFLECTION_FIELD_WGSL`, `REFLECTION_SURFACE_HIT_WGSL`). The ray leaves the surface along itself by `surfaceBias`; it goes no
 * further than the longest ray (`reflectionFar`).
 *
 * THE MARCH (`reflectionMarch`) begins where the screen stopped knowing the ray (`begin`, the distance the screen stage stored for it,
 * `reflectionTraceDistance`), less four half voxels of the
 * clipmap that holds that point, so that it starts outside the surface and the expansion of the surfaces works; it
 * expands the surface by the largest distance read so far, not by the ray's time, and steps the distance times a
 * factor drawn about 1 (`reflectionStepFactor`) near a mirror, whose noise spreads the stepping artefacts, and whole
 * for a wide cone.
 *
 * THE HIT is the first surface the march meets, opaque: the ray stops there whole. Its light is the cache's, read at
 * the point with the cone's footprint (the lobe's, and the pixel's at the eye) for the radius: where no card of
 * the placements near the hit gave any weight, the hit is black, at the march's distance.
 *
 * What a ray answers is its surface's radiance, whether it hit one, and the distance of the
 * first from `P`; nothing where it hits nothing, or where the scene has no field. `open`: whether the
 * march saw the ray leave the scene, to the longest ray or the scene's edge; also a ray the screen followed to the longest ray; not with no field to march.
 * `firstPerson`, whether the ray is cast from a first-person pixel, is the triangles' version's to read (`sceneTraceHardware.ts`): the field holds
 * no stand-in of a first-person object apart to leave out.
 * How the ray ended and the steps its march took are left in `reflectionFate` and `reflectionWork` (`censusWgsl.ts`),
 * for the trace's census to count.
 */
export const reflectionSceneTraceWgsl = (light: LightAtlasFormat) =>
  wgslBlock(
    `REFLECTION_SCENE_TRACE_WGSL(${light})`,
    [
      REFLECTION_LOBE_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_REACH_WGSL,
      REFLECTION_FATE_WGSL,
      REFLECTION_FIELD_WGSL,
      reflectionSurfaceHitWgsl(light),
      RADIANCE_ANSWER,
      REFLECTION_SCENE_TRACE_RESULT,
      interleavedGradientNoise,
    ],
    [MARCH_WGSL, HIT_WGSL, STAGE_WGSL].join('\n'),
  )

/** The scene stage's answer over a surface cache whose final light is stored in the word format. */
export const REFLECTION_SCENE_TRACE_WGSL = reflectionSceneTraceWgsl(WORD_LIGHT_FORMAT)
