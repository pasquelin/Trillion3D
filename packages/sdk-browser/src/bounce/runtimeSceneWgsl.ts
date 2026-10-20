import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../math/src/wgsl/constants.ts'
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts'
import { placementRay } from '../gpu/dag/placementRayWgsl.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'
import { transformHalfExtent } from '../../../math/src/wgsl/geometry.ts'
import { PLACEMENT_TREE_WALK_WGSL, placementTreeWalk } from '../gpu/dag/treeWalkWgsl.ts'
import { wideNodeFns } from './nodeWgsl.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from './traceWgsl.ts'
import {
  INSTANCE,
  RAY_TRIANGLES,
  RAY_TREE_STEPS,
  RAY_WORK,
  RUNTIME_PROXY_WGSL,
} from './runtimeLayout.ts'
import { worldTableWgsl } from '../gpu/dag/worldTable.ts'
import { treeTableWgsl } from '../gpu/dag/treeTable.ts'
import { sceneKey, type SceneBindings } from './sceneBindings.ts'

/**
 * THE PROXY'S RAYS: what a ray meets of the scene, compiled meshes and the cuts the world made at run time
 * alike. One traversal over two levels: the culling's placement tree, read in its record table — its nodes hold
 * the world boxes of up to 64 children, a group's children being placements — and, in each placement whose box the ray meets, its
 * mesh's own wide tree (`rtTraceCut`, the engine's one wide traversal, `wideTraversal`) in the mesh's own space,
 * the ray taken there by the inverse of the placement's world. The world is the culling's, read where it lies:
 * nothing is copied per placement; its four-word instance lies in its record beside it (`gpu/dag/worldTable.ts`).
 *
 * `rtScene` answers the nearest hit, `rtBlocked` whether anything stands on a segment — a shadow does not need
 * the nearest, and returns at the first surface.
 *
 * ONE BUDGET A RAY (`RAY_WORK`, `RAY_TRIANGLES`): every box, node and triangle, its shadow rays' too, spends
 * from the same counters; a ray that spends them is exhausted and carries zero weight (`runtimeLayout.ts`).
 */
export const runtimeSceneWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeSceneWgsl(${sceneKey(scene)})`,
    [
      RUNTIME_PROXY_WGSL,
      worldTableWgsl('rtWorlds', { group: scene.group, binding: scene.worlds, access: 'read' }),
      treeTableWgsl('rtTree', { group: scene.group, binding: scene.tree, access: 'read' }),
      WIDE_TRAVERSAL_WGSL,
      NO_INDEX,
      PLACEMENT_TREE_WALK_WGSL,
      placementRay,
      worldMatrix3,
      transformHalfExtent,
    ],
    `
${wgslConsts({
  RT_WORK: RAY_WORK,
  RT_TRIANGLES: RAY_TRIANGLES,
  RT_STEPS: BOUNCE_SETTINGS.traversalSteps,
  RT_TREE_STEPS: RAY_TREE_STEPS,
  RT_INSTANCE_NODE: INSTANCE.node,
  RT_INSTANCE_TRIANGLE: INSTANCE.triangle,
  RT_INSTANCE_SURFACE: INSTANCE.surface,
  RT_INSTANCE_MARK: INSTANCE.mark,
})}
@group(${scene.group}) @binding(${scene.proxy}) var<storage,read> rtProxy:RuntimeProxy;
/** The ray's spending: box tests and node visits in \`rtWork\`, triangle tests in \`rtTests\`. */
var<private> rtWork:u32;
var<private> rtTests:u32;
/** The work of the shadow rays a hit's lighting cast (\`rtBlocked\`), which the ray that hit is charged:
 *  the ray and its shadow rays share one budget (\`runtimeLayout.ts\`). */
var<private> rtExtra:u32;
/** Whether \`rtScene\` answers the first surface it meets, not the nearest (\`rtBlocked\`). */
var<private> rtAnyHit:bool;
/** Whether a shadow ray the ray's lighting cast (\`rtBlocked\`) spent its budget: the ray then
 *  carries zero weight, as one that spent its own (\`runtimeLayout.ts\`). */
var<private> rtLost:bool;
/** The units the ray may spend, its shadow rays' included: \`RT_WORK\`, or fewer (\`rtRadiance\`). */
var<private> rtBudget:u32;
/** A ray begins: nothing spent, nothing charged, nothing lost, the whole budget before it. */
fn rtBegin(){rtWork=0u;rtTests=0u;rtExtra=0u;rtLost=false;rtBudget=RT_WORK;}
fn rtSpent()->bool{return rtWork+rtExtra>=rtBudget||rtTests>=RT_TRIANGLES;}
fn rtFloat(word:u32)->f32{return bitcast<f32>(rtProxy.words[word]);}
fn rtVertex(index:u32,vertex:u32)->vec3f{
 return rtVec(rtProxy.trianglesWord+index*TRIANGLE_FLOATS+vertex*3u);
}
${wideNodeFns({
  box: 'rtBox',
  child: 'rtChild',
  source: 'rtProxy',
  float: 'rtFloat',
  vec: 'rtVec',
})}
struct RtHit{distance:f32,placement:u32,triangle:u32,found:bool,}
${wideTraversal({
  name: 'rtTraceCut',
  params: ',node0:u32,tri0:u32,placement:u32',
  returns: 'RtHit',
  start: 'var best=RtHit(limit,0u,0u,false);',
  empty: '',
  steps: 'RT_STEPS',
  box: 'rtBox(node0+node)',
  child: 'rtChild(node0+node,slot,frame)',
  visit: 'rtWork+=4u;',
  stop: 'if(rtSpent()){break;}',
  test: `rtTests++;rtWork+=2u;
     let distance=rayTriangleDistance(origin,direction,rtVertex(tri0+index,0u),rtVertex(tri0+index,1u),rtVertex(tri0+index,2u),best.distance);
     if(distance<best.distance){best=RtHit(distance,placement,tri0+index,true);if(rtAnyHit){return best;}}`,
  answer: 'best',
  overflow: 'rtWork=rtBudget;',
})}
/** Placement \`w\`'s world, column-major: the culling's, read in its record — its linear part and the exact
 *  translation beside the matrix, rounded once to the f32 a host write holds (\`rtWorldsTranslation\`; the
 *  matrix's own is no cut's) —. */
fn rtWorldOf(w:u32)->mat4x4f{
 let l=rtWorldsLinear(w);
 return mat4x4f(vec4f(l[0],0.0),vec4f(l[1],0.0),vec4f(l[2],0.0),vec4f(rtWorldsTranslation(w),1.0));
}
/** Where the ray enters placement \`w\`'s world box — the root of its cut's tree through its world —, past
 *  \`limit\` where it meets none or the placement draws no proxy: what the tree's walk orders a group by. */
fn rtEntry(w:u32,origin:vec3f,inverse:vec3f,limit:f32)->f32{
 let node0=rtWorldsInstance(w,0u)[RT_INSTANCE_NODE];
 if(node0==NO_INDEX){return limit+1.0;}
 let m=rtWorldOf(w);
 let local=rtBox(node0);
 let c=worldMatrix3(m)*((local.low+local.high)*0.5)+m[3].xyz;
 let extent=transformHalfExtent(m,(local.high-local.low)*0.5);
 return rayBoxEntry(c-extent,c+extent,origin,inverse,limit);
}
/** The ray against placement \`w\`: its world box first (\`rtEntry\`), then its cut's tree in its space. */
fn rtEnter(w:u32,origin:vec3f,direction:vec3f,inverse:vec3f,best:RtHit)->RtHit{
 if(rtEntry(w,origin,inverse,best.distance)>best.distance){return best;}
 let instance=rtWorldsInstance(w,0u);
 let m=rtWorldOf(w);
 let placed=placementRay(worldMatrix3(m),origin-m[3].xyz,direction);
 if(!placed.regular){return best;}
 let hit=rtTraceCut(placed.origin,placed.direction,best.distance,instance[RT_INSTANCE_NODE],instance[RT_INSTANCE_TRIANGLE],w);
 if(hit.found&&hit.distance<best.distance){return hit;}
 return best;
}
/** The nearest hit of the ray over every placement that draws a proxy, within \`limit\`: the
 *  placement tree walked front to back, a cell's children and a group's members nearest entry first.
 *  \`found\` is false past the budget, with the ray's counters spent: ask \`rtSpent\`. A packing with no
 *  tree holds a few placements, tried in turn. */
fn rtScene(origin:vec3f,direction:vec3f,limit:f32)->RtHit{
 var best=RtHit(limit,0u,0u,false);
 if(rtProxy.instances==0u){return best;}
 let inverse=rayInverseDirection(direction);
 if(rtProxy.treeRoot==NO_INDEX){
  for(var w=0u;w<rtProxy.members;w++){
   if(rtSpent()){break;}
   rtWork+=1u;
   best=rtEnter(w,origin,direction,inverse,best);
   if(rtAnyHit&&best.found){return best;}
  }
 }else{
${placementTreeWalk({
  root: 'rtProxy.treeRoot',
  table: 'rtTree',
  enter: 'best=rtEnter(w,origin,direction,inverse,best);if(rtAnyHit&&best.found){return best;}',
  entry: 'rtEntry(w,origin,inverse,best.distance)',
  stop: 'if(rtSpent()){done=true;break;}',
  visit: 'rtWork+=1u;',
  steps: 'RT_TREE_STEPS',
  cut: 'rtWork=rtBudget;',
})}
 }
 return best;
}
/** Whether anything of the proxy stands on the segment of length \`span\` from \`origin\` along \`direction\`: the
 *  first surface met answers, not the nearest. The ray spends what the ray the lighting is cast for left of
 *  their one budget, and is charged to it (\`rtExtra\`). A ray that spends its budget marks that ray lost (\`rtLost\`):
 *  its answer carries zero weight, and this one reports a blocker, which spares the rest of its lighting. */
fn rtBlocked(origin:vec3f,direction:vec3f,span:f32)->bool{
 let work=rtWork;
 let tests=rtTests;
 rtTests=0u;
 rtAnyHit=true;
 let hit=rtScene(origin,direction,span);
 rtAnyHit=false;
 let lost=rtSpent();
 rtLost=rtLost||lost;
 rtExtra+=max(rtWork,work)-work;
 rtWork=work;
 rtTests=tests;
 return hit.found||lost;
}
`,
  )
