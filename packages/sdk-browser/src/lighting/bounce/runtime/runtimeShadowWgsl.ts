import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import {
  PLACEMENT_TREE_WALK_WGSL,
  placementTreeAnyHit,
} from '../../../geometry/dag/tree/treeWalkWgsl.ts'
import { treeTableWgsl } from '../../../geometry/dag/tree/treeTable.ts'
import { sceneKey, type SceneBindings } from '../sceneBindings.ts'
import { TREE_WALK_SPENDING, runtimePlacementWgsl } from './runtimeSceneWgsl.ts'

/**
 * THE PROXY'S SHADOW RAYS: whether anything of the proxy (`runtimeSceneWgsl.ts`) stands on a segment — a
 * shadow does not need the nearest surface: `rtSceneAny` walks the placement tree once, in index order, and
 * returns at the first one, which `rtBlocked` asks.
 *
 * A SHADOW RAY HAS ITS BUDGET (`SHADOW_RAY_WORK`, `SHADOW_RAY_TRIANGLES`): `rtBlocked` sets the counters of the
 * ray it is cast for aside, walks from zero against its own and gives them back, so the walk of the ray never
 * pays for its lighting, and a ray that meets nothing, which walks its whole segment, is not cut by what the
 * ray spent before it. What it spends is counted for the census (`rtExtra`), never against the ray.
 *
 * A SHADOW RAY THAT SPENDS ITS BUDGET IS LIT: it has found nothing that stands in the light, as a point no
 * object was tested against has no shadow of any. Only a cut of one placement that ran out of stack
 * (`RT_CAUSE_MESH`) shades the point: that placement's own walk could not say. A surface found answers
 * whatever it cost. What spent a shadow ray is kept (`rtShadowCause`), the ray's own cause (`rtCause`) left as
 * it was.
 */
export const runtimeShadowWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeShadowWgsl(${sceneKey(scene)})`,
    [
      runtimePlacementWgsl(scene),
      treeTableWgsl('rtTree', { group: scene.group, binding: scene.tree, access: 'read' }),
      PLACEMENT_TREE_WALK_WGSL,
      NO_INDEX,
    ],
    `
/** The first surface of the proxy the ray meets within \`limit\`, any of them: the placement tree walked
 *  once in index order (\`placementTreeAnyHit\`), the first placement whose cut the ray meets answering.
 *  What a shadow ray asks: the same visibility as \`rtScene\`'s, without its order. */
fn rtSceneAny(origin:vec3f,direction:vec3f,limit:f32)->RtHit{
 var best=RtHit(limit,0u,0u,false);
 if(rtProxy.instances==0u){return best;}
 let inverse=rayInverseDirection(direction);
 if(rtProxy.treeRoot==NO_INDEX){
  for(var w=0u;w<rtProxy.members;w++){
   if(rtSpent()){break;}
   rtWork+=1u;
   best=rtEnter(w,origin,direction,inverse,best);
   if(best.found){return best;}
  }
 }else{
${placementTreeAnyHit({
  root: 'rtProxy.treeRoot',
  table: 'rtTree',
  enter: 'best=rtEnter(w,origin,direction,inverse,best);if(best.found){return best;}',
  ...TREE_WALK_SPENDING,
})}
 }
 return best;
}
/** Whether anything of the proxy stands on the segment of length \`span\` from \`origin\` along \`direction\`: the
 *  first surface met answers; a shadow ray that spends its own budget answers lit, unless a cut of one placement
 *  ran out of stack in it. The ray's counters, its cause included, are as they were. */
fn rtBlocked(origin:vec3f,direction:vec3f,span:f32)->bool{
 let work=rtWork;let tests=rtTests;let cause=rtCause;let budget=rtBudget;let testBudget=rtTestBudget;
 rtWork=0u;rtTests=0u;rtCause=0u;rtBudget=RT_SHADOW_WORK;rtTestBudget=RT_SHADOW_TRIANGLES;
 rtAnyHit=true;
 let hit=rtSceneAny(origin,direction,span);
 rtAnyHit=false;
 let spent=rtSpent();
 let blocked=hit.found||(spent&&rtCause==RT_CAUSE_MESH);
 if(hit.found){rtShadowHit++;}
 else{
  if(!blocked){rtShadowFree++;}
  if(spent&&rtShadowCause==0u){rtShadowCause=rtWhy();}
 }
 rtExtra+=rtWork;
 rtWork=work;rtTests=tests;rtCause=cause;rtBudget=budget;rtTestBudget=testBudget;
 return blocked;
}
`,
  )
