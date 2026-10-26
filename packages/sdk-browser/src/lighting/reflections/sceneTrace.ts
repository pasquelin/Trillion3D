import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { REFLECTION_FATE_WGSL } from './censusWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { RADIANCE_ANSWER, REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_FIELD_WGSL, REFLECTION_SURFACE_HIT_WGSL } from './trace/traceBindings.ts'

/**
 * The scene's answer to a reflection (`reflectionSceneTrace`), where the screen did not give one: a ray marched
 * through the global distance field (`gdfTrace`, `../distanceField/globalTraceWgsl.ts`), then, where it meets a
 * surface, the light of that surface read in the surface cache's final lighting (`scGlobalHit`, `../surfaceCache/hitWgsl.ts`), or
 * the lit image where it agrees with the depth (`reflectionSeenAt`, `rayLightWgsl.ts`). One ray a call, cast this
 * image, kept nowhere, by the trace's scene stage alone (`trace/trace.ts`), over its own group's field and cache
 * (`REFLECTION_FIELD_WGSL`, `REFLECTION_SURFACE_HIT_WGSL`). The ray leaves the surface along itself by `surfaceBias`; it goes no
 * further than `bound`, the surface the screen met, nor than the scene's edge (`reflectionSceneReach`, `reach.ts`) nor
 * the longest ray (`ReflectionView.march.w`).
 *
 * THE MARCH (`reflectionMarch`) begins where the screen stopped knowing the ray (`left`), less four half voxels of the
 * clipmap that holds that point, so that it starts outside the surface and the expansion of the surfaces works; it
 * expands the surface by the largest distance read so far, not by the ray's time, and steps the distance times a
 * factor drawn about 1 (`reflectionStepFactor`) near a mirror, whose noise spreads the stepping artefacts, and whole
 * for a wide cone.
 *
 * THE HIT is the first surface the march meets, opaque: the ray stops there whole. Its light is the cache's, read at
 * the point with the cone's footprint (the lobe's, and the pixel's at the eye) for the radius: where no card of
 * the placements near the hit gave any weight, the hit answers nothing and the ray goes on to the probes' field.
 *
 * What a ray answers is its surface's radiance and confidence (the share of the ray it stops), the distance of the
 * first from `P`; zero where it hits nothing, or where the scene has no field. `open`: the share of the ray that the
 * march saw leave the scene, to the longest ray or the scene's edge; none for a ray cut by `bound`, or with no field to march.
 * How the ray ended and the steps its march took are left in `reflectionFate` and `reflectionWork` (`censusWgsl.ts`),
 * for the trace's census to count.
 */
export const REFLECTION_SCENE_TRACE_WGSL = wgslBlock(
  'REFLECTION_SCENE_TRACE_WGSL',
  [
    REFLECTION_LOBE_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    REFLECTION_REACH_WGSL,
    REFLECTION_FATE_WGSL,
    REFLECTION_FIELD_WGSL,
    REFLECTION_SURFACE_HIT_WGSL,
    RADIANCE_ANSWER,
    interleavedGradientNoise,
  ],
  `struct ReflectionSceneTrace{answer:RadianceAnswer,open:f32,}
/** The factor of the march's step: drawn between \`REFLECTION_STEP_DITHER\` and its reciprocal by the pixel's noise of
 *  this image, and 1 for a ray whose cone (\`cone\`, radians) spans \`REFLECTION_STEP_DITHER_CONE\`. */
fn reflectionStepFactor(coord:vec2u,cone:f32)->f32{
 let drawn=mix(REFLECTION_STEP_DITHER,1.0/REFLECTION_STEP_DITHER,interleavedGradientNoise(vec2f(coord),f32(reflectionView.temporal.x%8u)));
 return mix(drawn,1.0,saturate(cone/REFLECTION_STEP_DITHER_CONE));
}
/** Where the march of the ray from \`P\` along \`R\` begins, centimetres from the point the ray leaves the surface at: the
 *  screen having stopped knowing it at \`left\` metres, less \`REFLECTION_PULLBACK\` half voxels of the clipmap that holds
 *  that point, from 0 on. */
fn reflectionMarchStart(P:vec3f,R:vec3f,left:f32)->f32{
 let there=left*REFLECTION_CENTIMETRES;
 let halfVoxel=gdfView.centerExtent[gdfClipmapAt(gdfTranslated(P*REFLECTION_CENTIMETRES)+R*there)].w*gdfView.texel;
 return max(there-REFLECTION_PULLBACK*halfVoxel,0.0);
}
/** The ray from \`P\` along \`R\` marched through the field from \`begin\` (\`reflectionMarchStart\`) over \`reach\` metres, from the
 *  point it leaves the surface at, \`bias\` metres along itself: the hit time in centimetres from that point, -1 where it met
 *  nothing, the clipmap and the steps taken. */
fn reflectionMarch(P:vec3f,R:vec3f,begin:f32,reach:f32,coord:vec2u,cone:f32)->GdfTraceResult{
 let start=(P+R*reflectionView.reach.x)*REFLECTION_CENTIMETRES;
 return gdfTraceRay(start,R,begin,reach*REFLECTION_CENTIMETRES,reflectionStepFactor(coord,cone),false,false,coord,0.0);
}
/** The point a ray's radiance is read from, the surface it leaves (\`reflectionFogged\`, \`reflectionSeenAt\`). */
var<private> reflectionOrigin:vec3f;
/** The answer of a march that met a surface at \`marched\`: the cache's light there, fogged along the ray and mixed with the lit
 *  image where it agrees, confidence 1 — nothing where no card gave any light. \`bias\` is the metres the march began
 *  from \`P\` along \`R\`. */
fn reflectionHitAnswer(P:vec3f,lobe:ReflectionLobe,marched:GdfTraceResult,bias:f32,coord:vec2u)->RadianceAnswer{
 // The cone of the ray at the hit: the lobe's, and the pixel's at the eye.
 let spread=lobe.tangent+reflectionPixelAt(P)/max(viewEyeDistance(P),REFLECTION_FLOOR);
 let origin=(P+lobe.R*bias)*REFLECTION_CENTIMETRES;
 let surface=scGlobalHit(origin,lobe.R,marched,spread,false,-1.0,reflectionDone(REFLECTION_HI_RES_SURFACE),coord);
 if(!surface.valid){return RadianceAnswer(vec3f(0.0),0.0,0.0);}
 let at=(origin+lobe.R*marched.hitTime)/REFLECTION_CENTIMETRES;
 return RadianceAnswer(reflectionSeenAt(surface.radiance,at,surface.face),1.0,bias+marched.hitTime/REFLECTION_CENTIMETRES);
}
fn reflectionSceneTrace(P:vec3f,lobe:ReflectionLobe,left:f32,bound:f32,coord:vec2u,cone:f32)->ReflectionSceneTrace{
 let none=ReflectionSceneTrace(RadianceAnswer(vec3f(0.0),0.0,0.0),0.0);
 reflectionFate=REFLECTION_FATE_NO_FIELD;
 reflectionWork=0u;
 if(gdfView.clipmaps==0u){return none;}
 let bias=reflectionView.reach.x;
 let limit=min(reflectionSceneReach(),reflectionView.march.w);
 // Never past the surface the screen met, its slab included.
 let far=min(limit,bound);
 let reach=far-bias;
 if(reach<=max(left-bias,0.0)){reflectionFate=REFLECTION_FATE_BOUND;return none;}
 // With the scene traces off nothing is marched: the ray goes whole to what lies past the scene.
 var answer=RadianceAnswer(vec3f(0.0),0.0,far);
 var open=select(0.0,1.0,far>=limit);
 reflectionOrigin=P;
 if(reflectionDone(REFLECTION_SCENE_TRACES)){
  let begin=reflectionMarchStart(P,lobe.R,left);
  let marched=reflectionMarch(P,lobe.R,begin,reach,coord,cone);
  reflectionWork=marched.steps;
  if(marched.hitTime>=0.0){
   // The march met a surface: the cache gives its light; one it holds none of answers nothing.
   answer=reflectionHitAnswer(P,lobe,marched,bias,coord);
   open=0.0;
  }
 }
 reflectionFate=select(select(REFLECTION_FATE_MISS,REFLECTION_FATE_OPEN,open>0.0),REFLECTION_FATE_HIT,answer.confidence>0.0);
 return ReflectionSceneTrace(answer,open);
}`,
)
