import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { placementRay } from '../../../geometry/dag/placement/placementRayWgsl.ts'
import { worldMatrix3 } from '../../../../../math/src/wgsl/matrix.ts'
import { transformHalfExtent } from '../../../../../math/src/wgsl/geometry.ts'
import {
  PLACEMENT_TREE_WALK_WGSL,
  placementTreeAnyHit,
  placementTreeWalk,
} from '../../../geometry/dag/tree/treeWalkWgsl.ts'
import { wideNodeFns } from '../nodeWgsl.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from '../traceWgsl.ts'
import {
  INSTANCE,
  PROBE_RAY_TRIANGLES,
  PROBE_RAY_WORK,
  RAY_TRIANGLES,
  RAY_WORK,
  RUNTIME_PROXY_WGSL,
} from './runtimeLayout.ts'
import { worldTableWgsl } from '../../../geometry/dag/worlds/worldTable.ts'
import { treeTableWgsl } from '../../../geometry/dag/tree/treeTable.ts'
import { sceneKey, type SceneBindings } from '../sceneBindings.ts'

/**
 * THE RAY'S STATE: the constants the proxy's rays share and what one ray spends and finds — the units
 * and triangle tests it has spent (`rtWork`, `rtTests`), those its shadow rays did (`rtExtra`), its
 * budget, what exhausted it, how far its walk had reached, the first surface it hit —, none of it
 * bound to a scene.
 */
const RT_RAY_WGSL = wgslBlock(
  'RT_RAY_WGSL',
  [],
  `
${wgslConsts({
  RT_WORK: RAY_WORK,
  RT_TRIANGLES: RAY_TRIANGLES,
  RT_PROBE_WORK: PROBE_RAY_WORK,
  RT_PROBE_TRIANGLES: PROBE_RAY_TRIANGLES,
  RT_CAUSE_WORK: 1,
  RT_CAUSE_TESTS: 2,
  RT_CAUSE_TREE: 3,
  RT_CAUSE_MESH: 4,
  RT_STEPS: BOUNCE_SETTINGS.traversalSteps,
  RT_INSTANCE_NODE: INSTANCE.node,
  RT_INSTANCE_TRIANGLE: INSTANCE.triangle,
  RT_INSTANCE_SURFACE: INSTANCE.surface,
  RT_INSTANCE_MARK: INSTANCE.mark,
})}
/** The ray's spending: box tests and node visits in \`rtWork\`, triangle tests in \`rtTests\`. */
var<private> rtWork:u32;
var<private> rtTests:u32;
/** The work of the shadow rays a hit's lighting cast (\`rtBlocked\`), which the ray that hit is charged:
 *  the ray and its shadow rays share one budget (\`runtimeLayout.ts\`). */
var<private> rtExtra:u32;
/** Whether the cuts' traversal answers the first surface it meets, not the nearest (\`rtBlocked\`). */
var<private> rtAnyHit:bool;
/** The units and the triangle tests the ray may spend, its shadow rays' included: \`RT_WORK\` and
 *  \`RT_TRIANGLES\`, or fewer (\`rtRadiance\`) or more (\`rtProbeRay\`). */
var<private> rtBudget:u32;
var<private> rtTestBudget:u32;
/** Why a ray's own walk was exhausted, the first thing that spent it (\`RT_CAUSE_*\`), zero while it is not. */
var<private> rtCause:u32;
/** How far along the ray the walk of the scene (\`rtScene\`) has reached, in metres, and in which placement: the
 *  furthest entry of a placement's box or of a leaf its cut tests (\`rtAdvance\`), where the walk was if its budget ran out. */
var<private> rtReached:f32;
var<private> rtReachedPlacement:u32;
fn rtAdvance(at:f32,w:u32){if(at>=rtReached){rtReached=at;rtReachedPlacement=w;}}
/** What the shadow rays its hits' lighting cast found, for the census: those that found nothing on their segment,
 *  those that found a surface, and what spent the first that spent the budget (\`RT_CAUSE_*\`, zero while none did). */
var<private> rtShadowFree:u32;
var<private> rtShadowHit:u32;
var<private> rtShadowCause:u32;
/** The units of the ray's work, its shadow rays' included, spent reading the members of the tree's groups, for the
 *  census: the rest went to the tree's cells and the cuts. */
var<private> rtMembers:u32;
/** A ray begins: nothing spent, nothing charged, the whole budget before it. */
fn rtBegin(){rtWork=0u;rtTests=0u;rtExtra=0u;rtBudget=RT_WORK;rtTestBudget=RT_TRIANGLES;rtCause=0u;rtShadowFree=0u;rtShadowHit=0u;rtShadowCause=0u;rtMembers=0u;}
fn rtSpent()->bool{return rtWork+rtExtra>=rtBudget||rtTests>=rtTestBudget;}
/** What spent the ray: a cause already named, else its units or its triangle tests. */
fn rtWhy()->u32{
 if(rtCause!=0u){return rtCause;}
 return select(RT_CAUSE_WORK,RT_CAUSE_TESTS,rtTests>=rtTestBudget);
}
`,
)

/** One mesh's cut: the proxy's buffer, its words and nodes read, and the wide traversal of a cut's tree
 *  (`rtTraceCut`) in the mesh's own space. */
const runtimeCutWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeCutWgsl(${sceneKey(scene)})`,
    [RT_RAY_WGSL, RUNTIME_PROXY_WGSL, WIDE_TRAVERSAL_WGSL],
    `
@group(${scene.group}) @binding(${scene.proxy}) var<storage,read> rtProxy:RuntimeProxy;
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
  test: `rtTests++;rtWork+=2u;rtAdvance(span,placement);
     let distance=rayTriangleDistance(origin,direction,rtVertex(tri0+index,0u),rtVertex(tri0+index,1u),rtVertex(tri0+index,2u),best.distance);
     if(distance<best.distance){best=RtHit(distance,placement,tri0+index,true);if(rtAnyHit){return best;}}`,
  answer: 'best',
  overflow: 'rtWork=rtBudget;rtCause=RT_CAUSE_MESH;',
})}
`,
  )

/** One placement: its world read in its record, where the ray enters its box and the ray against its cut. */
const runtimePlacementWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimePlacementWgsl(${sceneKey(scene)})`,
    [
      runtimeCutWgsl(scene),
      worldTableWgsl('rtWorlds', { group: scene.group, binding: scene.worlds, access: 'read' }),
      NO_INDEX,
      placementRay,
      worldMatrix3,
      transformHalfExtent,
    ],
    `
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
/** The ray against placement \`w\`: its world box first (\`rtEntry\`), where the walk has then reached (\`rtReached\`),
 *  then its cut's tree in its space. */
fn rtEnter(w:u32,origin:vec3f,direction:vec3f,inverse:vec3f,best:RtHit)->RtHit{
 let entry=rtEntry(w,origin,inverse,best.distance);
 if(entry>best.distance){return best;}
 rtAdvance(entry,w);
 let instance=rtWorldsInstance(w,0u);
 let m=rtWorldOf(w);
 let placed=placementRay(worldMatrix3(m),origin-m[3].xyz,direction);
 if(!placed.regular){return best;}
 let hit=rtTraceCut(placed.origin,placed.direction,best.distance,instance[RT_INSTANCE_NODE],instance[RT_INSTANCE_TRIANGLE],w);
 if(hit.found&&hit.distance<best.distance){return hit;}
 return best;
}
`,
  )

/** What both walks of the placement tree spend: a unit a child or a member read (the members counted apart). */
const TREE_WALK_SPENDING = {
  stop: 'if(rtSpent()){done=true;break;}',
  visit: 'rtWork+=1u;rtMembers+=select(0u,1u,group);',
  steps: '2u*rtBudget',
  cut: 'rtWork=rtBudget;rtCause=RT_CAUSE_TREE;',
}

/** The nearest hit: the placement tree walked front to back. */
const runtimeWalkWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeWalkWgsl(${sceneKey(scene)})`,
    [
      runtimePlacementWgsl(scene),
      treeTableWgsl('rtTree', { group: scene.group, binding: scene.tree, access: 'read' }),
      PLACEMENT_TREE_WALK_WGSL,
      NO_INDEX,
    ],
    `
/** The nearest hit of the ray over every placement that draws a proxy, within \`limit\`: the
 *  placement tree walked front to back, a cell's children and a group's members nearest entry first.
 *  \`found\` is false past the budget, with the ray's counters spent: ask \`rtSpent\`, and \`rtReached\` says how
 *  far the walk had got. A packing with no tree holds a few placements, tried in turn. */
fn rtScene(origin:vec3f,direction:vec3f,limit:f32)->RtHit{
 var best=RtHit(limit,0u,0u,false);
 rtReached=0.0;rtReachedPlacement=NO_INDEX;
 if(rtProxy.instances==0u){return best;}
 let inverse=rayInverseDirection(direction);
 if(rtProxy.treeRoot==NO_INDEX){
  for(var w=0u;w<rtProxy.members;w++){
   if(rtSpent()){break;}
   rtWork+=1u;
   best=rtEnter(w,origin,direction,inverse,best);
  }
 }else{
${placementTreeWalk({
  root: 'rtProxy.treeRoot',
  table: 'rtTree',
  enter: 'best=rtEnter(w,origin,direction,inverse,best);',
  entry: 'rtEntry(w,origin,inverse,best.distance)',
  ...TREE_WALK_SPENDING,
})}
 }
 return best;
}
`,
  )

/**
 * THE PROXY'S RAYS: what a ray meets of the scene, compiled meshes and the cuts the world made at run time
 * alike. One traversal over two levels: the culling's placement tree, read in its record table — its nodes hold
 * the world boxes of up to 64 children, a group's children being placements — and, in each placement whose box the ray meets, its
 * mesh's own wide tree (`rtTraceCut`, the engine's one wide traversal, `wideTraversal`) in the mesh's own space,
 * the ray taken there by the inverse of the placement's world. The world is the culling's, read where it lies:
 * nothing is copied per placement; its four-word instance lies in its record beside it (`geometry/dag/worlds/worldTable.ts`).
 *
 * `rtScene` answers the nearest hit, the placement tree walked front to back; `rtBlocked` whether anything stands on
 * a segment — a shadow does not need the nearest: `rtSceneAny` walks the tree once, in index order, and returns at
 * the first surface.
 *
 * ONE BUDGET A RAY (`RAY_WORK`, `RAY_TRIANGLES`): every box, node and triangle, its shadow rays' too, spends
 * from the same counters; a ray that spends them is exhausted, which ends it as a hit (`runtimeLayout.ts`).
 * `rtBlocked` asks the shadow ray: it spends what the ray it is cast for left of their one budget, charged to it
 * (`rtExtra`). A shadow ray that spends it has not finished: it counts as a blocker, as a trace that runs out of
 * steps counts as a hit, which spares the rest of its lighting, and the ray it is cast for keeps its weight. A
 * surface found answers whatever it cost. What spent a shadow ray is kept (`rtShadowCause`), the ray's own cause
 * (`rtCause`) left as it was.
 */
export const runtimeSceneWgsl = (scene: SceneBindings) =>
  wgslBlock(
    `runtimeSceneWgsl(${sceneKey(scene)})`,
    [
      runtimeWalkWgsl(scene),
      treeTableWgsl('rtTree', { group: scene.group, binding: scene.tree, access: 'read' }),
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
 *  first surface met answers, and a shadow ray that spends the ray's budget (\`rtExtra\`) counts as a blocker. */
fn rtBlocked(origin:vec3f,direction:vec3f,span:f32)->bool{
 let work=rtWork;
 let tests=rtTests;
 let cause=rtCause;
 rtTests=0u;
 rtAnyHit=true;
 let hit=rtSceneAny(origin,direction,span);
 rtAnyHit=false;
 let spent=rtSpent();
 if(hit.found){rtShadowHit++;}
 else if(!spent){rtShadowFree++;}
 else if(rtShadowCause==0u){rtShadowCause=rtWhy();}
 rtCause=cause;
 rtExtra+=max(rtWork,work)-work;
 rtWork=work;
 rtTests=tests;
 return hit.found||spent;
}
`,
  )
