import {
  NO_SCENE_MASKS,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { octDecode, octEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { sceneMaskWgsl } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import { surfaceHitCardsWgsl, type SurfaceHitBindings } from '../surfaceCache/hitWgsl.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { REFLECTION_FATE_WGSL } from './censusWgsl.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { RADIANCE_ANSWER, REFLECTION_LOBE_WGSL } from './field.ts'
import { REFLECTION_SCENE_TRACE_RESULT } from './sceneTrace.ts'
import {
  REFLECTION_HARDWARE_SCENE,
  REFLECTION_HIT_BINDINGS,
  REFLECTION_TRACE_BINDINGS,
} from './trace/traceBindings.ts'
import { reflectionHitWords } from './grids.ts'
import {
  HIT_LIGHT_WGSL,
  REFLECTION_HIT_LIT,
  REFLECTION_HIT_MATERIAL_WORD,
} from './hitLighting/constants.ts'
import { LIT_MATERIAL_WGSL } from './hitLighting/pathWgsl.ts'

/** The bits of a hit's first word in the hits' buffer: the trace met a triangle, and its walk was whole (no bound ended it). */
const REFLECTION_HIT_FOUND = 1
const REFLECTION_HIT_WHOLE = 2
/** The shift of the steps the walk took in that word, above the two bits. */
const REFLECTION_HIT_STEPS_SHIFT = 2

/** The hits' buffer the trace keeps the triangles its rays met in, for the answer to read (`reflectionHitWords` words a grid texel). */
const HITS_DECLARATION = `const REFLECTION_HIT_FOUND:u32=${REFLECTION_HIT_FOUND}u;
const REFLECTION_HIT_WHOLE:u32=${REFLECTION_HIT_WHOLE}u;
const REFLECTION_HIT_STEPS_SHIFT:u32=${REFLECTION_HIT_STEPS_SHIFT}u;
@group(0) @binding(${REFLECTION_TRACE_BINDINGS.hits}) var<storage,read_write> reflectionHits:array<u32>;`

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
 * (`reflectionFar`), `hardware.x` at least; where it has something to trace, its start is pulled back by `hardware.z`, never before
 * `hardware.x`. The translucent primitives are passed (met, with the hit lighting's refraction events, which light them) and the back faces of the primitives that are not two-sided are culled; a ray meets the stand-ins of first-person
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
 * THE TWO KERNELS: the trace and the answer are two passes over the rays the screen missed, so that the trace — which reads the colour atlas of the masked surfaces (`rays/sceneTrace/sceneMaskWgsl.ts`) — and the
 * answer — which reads the surface cache and the fog's cubemap — do not hold their sampled textures in one stage. `reflectionSceneHitStore` (the kernel `traceSceneHit`) casts the ray of a grid texel and keeps the triangle it met
 * in the hits' buffer at the texel (`reflectionHitWords` words: the found and whole bits with the steps the walk took, the distance, the normal packed as two 16-bit octahedral coordinates and the object); `reflectionSceneTrace` (the kernel `traceScene`) reads it back and answers.
 *
 * `reflectionDistantStart`: where the screen's far trace of a ray the scene's triangles missed begins: where the ray leaves the sphere of the
 * scene trace's culling radius (`stParams.cullRadius`) about the eye, `32/31` of the exit less `1/31` of the trace's length, from the
 * surface itself where it is outside the sphere.
 */
export const reflectionSceneTraceHardwareWgsl = (
  light: LightAtlasFormat,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
  cards: SurfaceHitBindings = REFLECTION_HIT_BINDINGS,
  lit = false,
) =>
  wgslBlock(
    `REFLECTION_SCENE_TRACE_HARDWARE_WGSL(${light},${sceneMaskKey(programs)}${cards.visualize ? ',indirect' : ''}${lit ? ',lit' : ''})`,
    [
      octDecode,
      octEncode,
      REFLECTION_LOBE_WGSL,
      REFLECTION_CONSTANTS_WGSL,
      REFLECTION_FATE_WGSL,
      RADIANCE_ANSWER,
      REFLECTION_SCENE_TRACE_RESULT,
      ...(lit ? [HIT_LIGHT_WGSL, LIT_MATERIAL_WGSL] : []),
      surfaceHitCardsWgsl(cards, light),
      sceneTraceWgsl(REFLECTION_HARDWARE_SCENE.group, REFLECTION_HARDWARE_SCENE.first),
      sceneMaskWgsl(REFLECTION_HARDWARE_SCENE.group, REFLECTION_HARDWARE_SCENE.first, programs),
    ],
    `${HITS_DECLARATION}
fn reflectionDistantStart(P:vec3f,R:vec3f,stop:f32)->f32{
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
/** The answer of a trace that met the triangle hit from origin along R: the light of the cards of its placement, black where none
 *  gives any, seen as a surface the march met is (reflectionSeenAt), a hit. */
fn reflectionHardwareHit(origin:vec3f,R:vec3f,hit:StHit,coord:vec2u,cone:f32)->RadianceAnswer{
 let at=origin+R*hit.distance;
 let cards=scPlacementMeshCards(scHitPlacement(hit.object));
 let radius=reflectionHitSpread(cone)*hit.distance*REFLECTION_CENTIMETRES;
 let light=scEvaluateMeshCards(cards,at*REFLECTION_CENTIMETRES,hit.normal,radius,reflectionView.hardware.w,reflectionDone(REFLECTION_HI_RES_SURFACE),coord);
 // The lit image the hit may take, read once for the mark below and for what the hit shows.
 let noise=reflectionEdgeNoise(coord);
 let held=reflectionHeld(at,hit.normal,noise);
 let screen=reflectionHeldWins(held,noise);
${
  lit
    ? ` // The hit the cache cannot light (or every hit, under the forced hit lighting), where the lit image does not answer, is lit again by the hit lighting pass.
 if(hitLightOn()&&(hitLightForced()||(!light.valid&&!screen))){reflectionHits[reflectionHitAt(coord)]|=${REFLECTION_HIT_LIT}u;}
`
    : ''
} return RadianceAnswer(reflectionSeenFrom(light.radiance,held,screen,at,hit.normal),true,hit.distance);
}
/** The ray a grid texel casts through the scene's triangles from the surface point P of normal N along R, the screen having stopped knowing it at begin: its origin, where it runs from and to (start, far), its flags, and whether it traces at all (go). */
struct ReflectionSceneRay{origin:vec3f,start:f32,far:f32,flags:u32,go:bool,}
fn reflectionSceneRayOf(P:vec3f,N:vec3f,R:vec3f,begin:f32,firstPerson:bool)->ReflectionSceneRay{
 let bias=reflectionView.hardware.x;
 var ray:ReflectionSceneRay;
 ray.far=max(reflectionFar(),bias);
 ray.go=max(begin,bias)<ray.far&&reflectionDone(REFLECTION_SCENE_TRACES);
 // Where it has something to trace, its start is pulled back by hardware.z, never before hardware.x.
 ray.start=max(max(begin,bias)-reflectionView.hardware.z,bias);
 ray.origin=P+N*(saturate(dot(N,R))*reflectionView.hardware.y);
 ray.flags=${lit ? 'select(ST_SKIP_TRANSLUCENT,ST_MEET_TRANSLUCENT,hitLightOn()&&hitLightRefractions()>0u)' : 'ST_SKIP_TRANSLUCENT'}|ST_CULL_BACK|select(ST_MEET_WORLD_SPACE,0u,firstPerson);
 return ray;
}
/** The first word of the record of the texel coord in the hits' buffer. */
fn reflectionHitAt(coord:vec2u)->u32{return (coord.y*reflectionGridSize().x+coord.x)*${reflectionHitWords(lit)}u;}
/** The trace of the ray of grid texel coord (the kernel traceSceneHit): the triangle it meets kept in the hits' buffer. A ray that has nothing to trace keeps no hit and a whole walk. */
fn reflectionSceneHitStore(P:vec3f,N:vec3f,R:vec3f,begin:f32,coord:vec2u,firstPerson:bool){
 let ray=reflectionSceneRayOf(P,N,R,begin,firstPerson);
 var hit:StHit;
 hit.normal=vec3f(0.0);
 hit.object=0xffffffffu;
 if(ray.go){hit=stTrace(StRay(ray.origin-view.display.yzw,R,ray.start,ray.far,ray.flags));}
 let at=reflectionHitAt(coord);
 let steps=min(select(0u,stSteps,ray.go),0x7fffffffu>>REFLECTION_HIT_STEPS_SHIFT);
 reflectionHits[at]=select(0u,REFLECTION_HIT_FOUND,hit.hit)|select(REFLECTION_HIT_WHOLE,select(0u,REFLECTION_HIT_WHOLE,stComplete),ray.go)|(steps<<REFLECTION_HIT_STEPS_SHIFT);
 reflectionHits[at+1u]=bitcast<u32>(hit.distance);
 reflectionHits[at+2u]=pack2x16snorm(octEncode(hit.normal));
 reflectionHits[at+3u]=hit.object;${
   lit
     ? `
 if(hit.hit){
  reflectionHits[at+${REFLECTION_HIT_MATERIAL_WORD}u]=litMaterialKey(hit.placement,hit.record);
  // A translucent surface the path goes through is lit by the hit lighting whatever the cache gives it.
  if(hitLightOn()&&hitLightRefractions()>0u&&litTranslucent(hit.placement,hit.record)){reflectionHits[at]|=${REFLECTION_HIT_LIT}u;}
 }`
     : ''
 }
}
fn reflectionSceneTrace(P:vec3f,N:vec3f,lobe:ReflectionLobe,begin:f32,coord:vec2u,cone:f32,firstPerson:bool)->ReflectionSceneTrace{
 reflectionWork=0u;
 let ray=reflectionSceneRayOf(P,N,lobe.R,begin,firstPerson);
 // A ray that reached the end of the longest ray goes whole to what lies past the scene.
 var answer=RadianceAnswer(vec3f(0.0),false,ray.far);
 var open=true;
 reflectionOrigin=P;
 if(ray.go){
  let at=reflectionHitAt(coord);
  let flags=reflectionHits[at];
  reflectionWork=(flags&0x7fffffffu)>>REFLECTION_HIT_STEPS_SHIFT;
  if((flags&REFLECTION_HIT_FOUND)!=0u){
   var hit:StHit;
   hit.hit=true;
   hit.distance=bitcast<f32>(reflectionHits[at+1u]);
   hit.normal=octDecode(unpack2x16snorm(reflectionHits[at+2u]));
   hit.object=reflectionHits[at+3u];
   answer=reflectionHardwareHit(ray.origin,lobe.R,hit,coord,cone);
   open=false;
  }else if((flags&REFLECTION_HIT_WHOLE)==0u){
   // A trace that stopped before its walk was whole, holding no hit, is a black hit at the end of the ray.
   answer=RadianceAnswer(vec3f(0.0),true,ray.far);
   open=false;
  }
 }
 reflectionFate=select(REFLECTION_FATE_OPEN,REFLECTION_FATE_HIT,answer.hit);
 return ReflectionSceneTrace(answer,open);
}`,
  )
