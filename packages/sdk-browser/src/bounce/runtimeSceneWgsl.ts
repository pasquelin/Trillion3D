import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../math/src/wgsl/constants.ts'
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts'
import { PROXY_TRIANGLE_FLOATS } from '../../../sdk-core/src/contracts/writtenFormats.ts'
import { placementRay } from '../gpu/dag/placementRayWgsl.ts'
import { worldMatrix3 } from '../../../math/src/wgsl/matrix.ts'
import { transformHalfExtent } from '../../../math/src/wgsl/geometry.ts'
import { PLACEMENT_TREE_WALK_WGSL, placementTreeWalk } from '../gpu/dag/treeWalkWgsl.ts'
import { wideNodeFns } from './nodeWgsl.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from './traceWgsl.ts'
import {
  INSTANCE,
  RAY_TRIANGLES,
  RAY_WORK,
  RUNTIME_PROXY_WGSL,
  RUNTIME_WORLD_WORDS,
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
 * ONE BUDGET A RAY (`RAY_WORK`, `RAY_TRIANGLES`): every box tested at either level, every node
 * visited and every triangle spends from the same counters; a ray that spends them, or whose shadow
 * ray spends its own (`rtLost`), is exhausted and carries zero weight (`runtimeLayout.ts`).
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
  RT_TREE_STEPS: 2 * RAY_WORK,
  RT_INSTANCE_NODE: INSTANCE.node,
  RT_INSTANCE_TRIANGLE: INSTANCE.triangle,
  RT_INSTANCE_SURFACE: INSTANCE.surface,
  RT_INSTANCE_MARK: INSTANCE.mark,
  RT_WORLD_WORDS: RUNTIME_WORLD_WORDS,
  RT_TRIANGLE_FLOATS: PROXY_TRIANGLE_FLOATS,
})}
@group(${scene.group}) @binding(${scene.proxy}) var<storage,read> rtProxy:RuntimeProxy;
/** The ray's spending: box tests and node visits in \`rtWork\`, triangle tests in \`rtTests\`. */
var<private> rtWork:u32;
var<private> rtTests:u32;
/** The work of the shadow rays a hit's lighting cast (\`rtBlocked\`), which the ray that hit is charged. */
var<private> rtExtra:u32;
/** Whether \`rtScene\` answers the first surface it meets, not the nearest (\`rtBlocked\`). */
var<private> rtAnyHit:bool;
/** Whether a shadow ray the ray's lighting cast (\`rtBlocked\`) spent its budget: the ray then
 *  carries zero weight, as one that spent its own (\`runtimeLayout.ts\`). */
var<private> rtLost:bool;
fn rtSpent()->bool{return rtWork>=RT_WORK||rtTests>=RT_TRIANGLES;}
fn rtFloat(word:u32)->f32{return bitcast<f32>(rtProxy.words[word]);}
fn rtVertex(index:u32,vertex:u32)->vec3f{
 let base=rtProxy.trianglesWord+index*RT_TRIANGLE_FLOATS+vertex*3u;
 return vec3f(rtFloat(base),rtFloat(base+1u),rtFloat(base+2u));
}
${wideNodeFns({ box: 'rtBox', child: 'rtChild', source: 'rtProxy', float: 'rtFloat' })}
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
  overflow: 'rtWork=RT_WORK;',
})}
/** Placement \`w\`'s world, column-major: a placement's is the culling's, read in its record —
 *  its linear part (\`rtWorldsLinear\`) and the exact translation beside the matrix, rounded once to
 *  the single-precision value a host write holds (\`rtWorldsTranslation\`; the matrix's own is no
 *  cut's); a blended copy's, the proxy's own, past the placements. */
fn rtWorldOf(w:u32)->mat4x4f{
 if(w>=rtProxy.instances){
  let at=rtProxy.copyWorldsWord+(w-rtProxy.instances)*RT_WORLD_WORDS;
  return mat4x4f(rtFloat(at),rtFloat(at+1u),rtFloat(at+2u),0.0,
   rtFloat(at+4u),rtFloat(at+5u),rtFloat(at+6u),0.0,
   rtFloat(at+8u),rtFloat(at+9u),rtFloat(at+10u),0.0,
   rtFloat(at+12u),rtFloat(at+13u),rtFloat(at+14u),1.0);
 }
 let l=rtWorldsLinear(w);
 return mat4x4f(vec4f(l[0],0.0),vec4f(l[1],0.0),vec4f(l[2],0.0),vec4f(rtWorldsTranslation(w),1.0));
}
/** The ray against placement \`w\`: its world box, the root of its cut's tree through the world, first —
 *  a ray that misses it is one unit spent — then the cut's tree with the ray taken to its space. */
fn rtEnter(w:u32,origin:vec3f,direction:vec3f,inverse:vec3f,best:RtHit)->RtHit{
 // Its instance, read once in its record: the root of its cut's tree, then its first triangle.
 let instance=rtWorldsInstance(w,0u);
 let node0=instance[RT_INSTANCE_NODE];
 if(node0==NO_INDEX){return best;}
 let m=rtWorldOf(w);
 let linear=worldMatrix3(m);
 let local=rtBox(node0);
 let c=linear*((local.low+local.high)*0.5)+m[3].xyz;
 let extent=transformHalfExtent(m,(local.high-local.low)*0.5);
 if(rayBoxEntry(c-extent,c+extent,origin,inverse,best.distance)>best.distance){return best;}
 let placed=placementRay(linear,origin-m[3].xyz,direction);
 if(!placed.regular){return best;}
 let hit=rtTraceCut(placed.origin,placed.direction,best.distance,node0,instance[RT_INSTANCE_TRIANGLE],w);
 if(hit.found&&hit.distance<best.distance){return hit;}
 return best;
}
/** The nearest hit of the ray over every placement that draws a proxy, within \`limit\`: the
 *  placement tree walked depth first, a child entered when its box is met, a group's members one by one.
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
  stop: 'if(rtSpent()){done=true;break;}',
  visit: 'rtWork+=1u;',
  steps: 'RT_TREE_STEPS',
  cut: 'rtWork=RT_WORK;',
})}
 }
 // The blended copies, members after the placements: each tried in turn, a unit apiece.
 for(var k=0u;k<rtProxy.copies;k++){
  if(rtSpent()){break;}
  rtWork+=1u;
  best=rtEnter(rtProxy.instances+k,origin,direction,inverse,best);
  if(rtAnyHit&&best.found){return best;}
 }
 return best;
}
/** Whether anything of the proxy stands on the segment of length \`span\` from \`origin\` along \`direction\`: the
 *  first surface met answers, not the nearest. The ray has its own budget; what it spent is charged to the
 *  ray the lighting is cast for (\`rtExtra\`). A ray that spends its budget marks that ray lost (\`rtLost\`):
 *  its answer carries zero weight, and this one reports a blocker, which spares the rest of its lighting. */
fn rtBlocked(origin:vec3f,direction:vec3f,span:f32)->bool{
 let work=rtWork;
 let tests=rtTests;
 rtWork=0u;
 rtTests=0u;
 rtAnyHit=true;
 let hit=rtScene(origin,direction,span);
 rtAnyHit=false;
 let lost=rtSpent();
 rtLost=rtLost||lost;
 rtExtra+=rtWork;
 rtWork=work;
 rtTests=tests;
 return hit.found||lost;
}
`,
  )
