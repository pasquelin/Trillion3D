import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { sceneTraceWgsl } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import { surfaceHitCardsWgsl } from '../surfaceCache/hitWgsl.ts'
import { REFLECTION_FATE_WGSL } from './censusWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { RADIANCE_ANSWER, REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_SCENE_TRACE_RESULT } from './sceneTrace.ts'
import { REFLECTION_HARDWARE_SCENE, REFLECTION_HIT_BINDINGS } from './trace/traceBindings.ts'

/**
 * The scene's answer to a reflection (`reflectionSceneTrace`, answering what `sceneTrace.ts`'s does) where the scene has acceleration
 * structures: the ray traced against the primitives' triangles (`../rays/sceneTrace/sceneTraceWgsl.ts`, in group
 * `REFLECTION_HARDWARE_SCENE.group`) instead of marched through the global distance field, the light of the triangle it meets read
 * in the surface cache's final lighting from the cards of the placement it met (`scHitPlacement`, `scEvaluateMeshCards`,
 * `../surfaceCache/hitWgsl.ts`, in group 0 with the feedback the finer page a cone would have read is asked by). The ray is taken to
 * the eye's frame the scene trace works in (`view.display.yzw`).
 *
 * THE RAY starts at the surface `P` moved along its normal `N` by `ReflectionView.hardware.y` as far as the ray leans on it
 * (`saturate(N·R)`). It runs from where the screen stopped knowing it (`begin`), `hardware.x` at least, to the longest ray
 * (`ReflectionView.march.w`), `hardware.x` at least; where it has something to trace, its start is pulled back by `hardware.z`, never before
 * `hardware.x`. The translucent primitives are passed and the back faces of the primitives that are not two-sided are culled; a ray meets the stand-ins of first-person
 * objects (`ST_MEET_WORLD_SPACE`) unless it is cast from a first-person pixel (`firstPerson`), so that a mesh does not meet its other copy.
 *
 * THE ANSWER: a hit brings the light the cards of its placement hold at its point (`reflectionHardwareHit`), its normal facing the ray, with
 * the cone of the ray (`reflectionHitSpread`: the pixel's angle and the ray's `cone`) at the hit's distance for the radius and
 * `hardware.w` for the depth of a texel from the point, held to the ceiling of a ray, fogged, or the lit image where it agrees
 * and wins the pixel's noise (`reflectionSeenAt`); a hit no card gives any light of is black, a hit all the same. Where the trace found
 * no hit and stopped before its walk was whole (`stComplete`), it is a black hit at the end of the ray; otherwise a ray that hits nothing
 * leaves the scene (`open`, the stage then looking at the screen past it and at the sky). How the ray ended and the triangles it
 * tested are left in `reflectionFate` and `reflectionWork`, as the march's are.
 *
 * `reflectionDistantStart`: where the screen's far trace of a ray the scene's triangles missed begins: where the ray leaves the sphere of the
 * scene trace's culling radius (`stParams.cullRadius`) about the eye, `32/31` of the exit less `1/31` of the trace's length, from the
 * surface itself where it is outside the sphere.
 */
export const REFLECTION_SCENE_TRACE_HARDWARE_WGSL = wgslBlock(
  'REFLECTION_SCENE_TRACE_HARDWARE_WGSL',
  [
    REFLECTION_LOBE_WGSL,
    REFLECTION_CONSTANTS_WGSL,
    REFLECTION_FATE_WGSL,
    RADIANCE_ANSWER,
    REFLECTION_SCENE_TRACE_RESULT,
    surfaceHitCardsWgsl(REFLECTION_HIT_BINDINGS),
    sceneTraceWgsl(REFLECTION_HARDWARE_SCENE.group, REFLECTION_HARDWARE_SCENE.first),
  ],
  `fn reflectionDistantStart(P:vec3f,R:vec3f,stop:f32)->f32{
 let local=P-view.display.yzw;
 let radius=stParams.cullRadius;
 let along=dot(R,local);
 let discriminant=along*along-(dot(local,local)-radius*radius);
 if(discriminant<0.0){return 0.0;}
 let root=sqrt(discriminant);
 let exit=root-along;
 if(!(-along-root<0.0&&exit>0.0)){return 0.0;}
 return max(32.0/31.0*exit-stop/31.0,0.0);
}
/** The answer of a trace that met the triangle \`hit\` from \`origin\` along \`R\`: the light of the cards of its placement, black where none
 *  gives any, seen as a surface the march met is (\`reflectionSeenAt\`), a hit. */
fn reflectionHardwareHit(P:vec3f,origin:vec3f,R:vec3f,hit:StHit,coord:vec2u,cone:f32)->RadianceAnswer{
 let at=origin+R*hit.distance;
 let cards=scPlacementMeshCards(scHitPlacement(hit.object));
 let radius=reflectionHitSpread(cone)*hit.distance*REFLECTION_CENTIMETRES;
 let light=scEvaluateMeshCards(cards,at*REFLECTION_CENTIMETRES,hit.normal,radius,reflectionView.hardware.w,reflectionDone(REFLECTION_HI_RES_SURFACE),coord);
 return RadianceAnswer(reflectionSeenAt(light.radiance,at,hit.normal,coord),true,distance(P,at));
}
fn reflectionSceneTrace(P:vec3f,N:vec3f,lobe:ReflectionLobe,begin:f32,coord:vec2u,cone:f32,firstPerson:bool)->ReflectionSceneTrace{
 reflectionWork=0u;
 let bias=reflectionView.hardware.x;
 let far=max(reflectionView.march.w,bias);
 var start=max(begin,bias);
 // A ray that reached the end of the longest ray goes whole to what lies past the scene.
 var answer=RadianceAnswer(vec3f(0.0),false,far);
 var open=true;
 reflectionOrigin=P;
 if(start<far&&reflectionDone(REFLECTION_SCENE_TRACES)){
  start=max(start-reflectionView.hardware.z,bias);
  let origin=P+N*(saturate(dot(N,lobe.R))*reflectionView.hardware.y);
  let hit=stTrace(StRay(origin-view.display.yzw,lobe.R,start,far,ST_SKIP_TRANSLUCENT|ST_CULL_BACK|select(ST_MEET_WORLD_SPACE,0u,firstPerson)));
  reflectionWork=stSteps;
  if(hit.hit){
   answer=reflectionHardwareHit(P,origin,lobe.R,hit,coord,cone);
   open=false;
  }else if(!stComplete){
   // A trace that stopped before its walk was whole, holding no hit, is a black hit at the end of the ray.
   answer=RadianceAnswer(vec3f(0.0),true,far);
   open=false;
  }
 }
 reflectionFate=select(REFLECTION_FATE_OPEN,REFLECTION_FATE_HIT,answer.hit);
 return ReflectionSceneTrace(answer,open);
}`,
)
