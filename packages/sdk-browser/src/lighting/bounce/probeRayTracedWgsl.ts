import {
  NO_SCENE_MASKS,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { sceneMaskWgsl } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneTraceWgsl } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import { CACHE_LIT_MARKING_WGSL } from './cache/cacheLitMark.ts'
import type { SurfaceHitBindings } from '../surfaceCache/hitWgsl.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { PROBE_RAY_WGSL } from './probeRayWgsl.ts'
import { tracedHitLightWgsl } from './tracedHitWgsl.ts'

/** What a hit brings back: the light of its cards, or, where it is marked for the hit lighting's passes, its mark. */
const hitAnswer = (hitLit: boolean) =>
  hitLit
    ? 'probeMark=vec2u(cacheLitMark(hit.placement,hit.record,hit.frontFace,hit.twoSided),bitcast<u32>(hit.distance));'
    : 'out.lighting=tracedHitLight(hit,origin,d,side,cache.traced.y,cache.traced.z,coord);'

/**
 * THE RAY OF A WORLD PROBE CAST THROUGH THE SCENE'S TRIANGLES (`probeRay`, answering what `probeRayWgsl.ts`'s does): the same ray,
 * traced against the primitives' acceleration structures (`../rays/sceneTrace/sceneTraceWgsl.ts`, in group `scene.group`) where the
 * scene has them, instead of marched through the global distance field.
 *
 * The ray leaves the probe's centre `origin` along `d` (nothing along the normal: it has none), from `begin` metres to the probes'
 * `reach` less the pullback bias (`cache.traced.x`, never before `begin`), ignoring the translucent primitives and culling no face, so
 * that a ray that starts inside a wall finds it and leaks less; the self-intersections are not avoided. A trace that stopped before
 * its walk was whole (`stComplete`) and found nothing is a black hit at the end of the ray; one that found a hit keeps the hit's light. A
 * ray that hits nothing and was whole leaves the scene (`open`, the caller reading the sky along it). A hit brings the light of the cards of the
 * placement it met (`tracedHitLight`, `tracedHitWgsl.ts`: the sampling depth bias is `cache.traced.y`, centimetres, and a hit nearer than
 * `cache.traced.z` centimetres brings none), each a hit all the same, and the answer says whether the surface faces the ray and whether it is
 * two-sided (`front`, `twoSided`). The ray is taken to the eye's frame the scene trace works in (`cache.eye`). A program that calls it
 * declares the cache's parameters (`cache`, `RADIANCE_CACHE_PARAMS`).
 *
 * With `hitLit` a hit is not lit from the cards but marked for the hit lighting's passes (`../cache/cacheHitLitWgsl.ts`): `probeMark` holds the mark word
 * (`CACHE_LIT_MARK`, the key of the hit's material in its low fifteen bits, `litMaterialKey`, and whether the surface faces the ray and is two-sided) and the
 * distance of the hit, and the answer's light is none; a ray that marks nothing leaves it zero.
 */
export const probeRayTracedWgsl = (
  cards: Pick<SurfaceHitBindings, 'group' | 'cards' | 'instances'>,
  scene: { readonly group: number; readonly first: number },
  light: LightAtlasFormat,
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
  hitLit = false,
) =>
  wgslBlock(
    `probeRayTracedWgsl(${cards.group},${cards.cards},${cards.instances},${scene.group},${scene.first},${light},${sceneMaskKey(programs)},${hitLit})`,
    [
      PROBE_RAY_WGSL,
      sceneTraceWgsl(scene.group, scene.first),
      ...(hitLit
        ? [CACHE_LIT_MARKING_WGSL, sceneMaskWgsl(scene.group, scene.first, programs)]
        : [tracedHitLightWgsl(cards, scene, light, programs)]),
    ],
    `fn probeRay(origin:vec3f,d:vec3f,begin:f32,reach:f32,side:f32,coord:vec2u)->ProbeRay{
 var out=ProbeRay(vec3f(0.0),1.0,max(reach-cache.traced.x,begin),0u,true,false);
 let end=out.distance;
 let hit=stTrace(StRay(origin-cache.eye.xyz,d,begin,end,ST_SKIP_TRANSLUCENT));
 out.steps=stSteps;
 if(hit.hit){
  out.front=hit.frontFace;
  out.twoSided=hit.twoSided;
 }
 if(!hit.hit){
  if(!stComplete){out.open=0.0;}
  return out;
 }
 out.open=0.0;
 out.distance=hit.distance;
 ${hitAnswer(hitLit)}
 return out;
}`,
  )
