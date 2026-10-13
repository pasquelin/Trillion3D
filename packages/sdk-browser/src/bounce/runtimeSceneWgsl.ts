import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { BOUNCE_SETTINGS, PROXY_TRIANGLE_FLOATS } from '../../../sdk-core/src/index.ts'
import { DAG_NODE_FLOATS } from '../gpu/dag/types.ts'
import {
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_KIND,
  NODE_MAX,
  NODE_MIN,
} from '../gpu/dag/nodeLayout.ts'
import { TREE_GROUP } from '../gpu/dag/placementTree.ts'
import { wideNodeFns } from './nodeWgsl.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from './traceWgsl.ts'
import { INSTANCE_WORDS, RAY_TRIANGLES, RAY_WORK, RUNTIME_NONE } from './runtimeLayout.ts'

/** The bindings of the proxy in a program that casts its rays: its own buffer (`runtimeLayout.ts`), which holds
 *  the placement tree it walks, and the world matrices of the first range (`gpu/dag/frameRanges.ts`). */
export type SceneBindings = { group: number; proxy: number }

/** Tree levels a ray walks down at most: a tree of 64-way nodes holds 2⁴² members in seven. */
const TREE_DEPTH = 8

/**
 * THE PROXY'S RAYS: what a ray meets of the scene, compiled meshes and the cuts the world made at run time
 * alike. One traversal over two levels: the culling's placement tree — its nodes hold the world boxes of up to
 * 64 children, a group's children being placements — and, in each placement whose box the ray meets, its
 * mesh's own wide tree (`rtTraceCut`, the engine's one wide traversal, `wideTraversal`) in the mesh's own space,
 * the ray taken there by the inverse of the placement's world. The world is the culling's, read where it lies:
 * nothing is copied per placement but a four-word instance (`runtimeLayout.ts`).
 *
 * `rtScene` answers the nearest hit, `rtBlocked` whether anything stands on a segment — a shadow does not need
 * the nearest, and returns at the first surface.
 *
 * ONE BUDGET A RAY (`RAY_WORK`, `RAY_TRIANGLES`): every box tested at either level, every node
 * visited and every triangle spends from the same counters; a ray that spends them is `exhausted`
 * and answers nothing (`rtScene`, `rtRadiance`): the next stage of the chain answers, never a miss.
 */
export const runtimeSceneWgsl = ({ group, proxy }: SceneBindings) =>
  wgslBlock(
    `runtimeSceneWgsl(${group}, ${proxy})`,
    [WIDE_TRAVERSAL_WGSL],
    `
${wgslConsts({
  RT_NONE: RUNTIME_NONE,
  RT_WORK: RAY_WORK,
  RT_TRIANGLES: RAY_TRIANGLES,
  RT_STEPS: BOUNCE_SETTINGS.traversalSteps,
  RT_TREE_DEPTH: TREE_DEPTH,
  RT_TREE_STEPS: 2 * RAY_WORK,
  RT_TREE_FLOATS: DAG_NODE_FLOATS,
  RT_TREE_GROUP: TREE_GROUP,
  RT_NODE_MIN: NODE_MIN,
  RT_NODE_MAX: NODE_MAX,
  RT_NODE_FIRST: NODE_FIRST_CHILD,
  RT_NODE_COUNT: NODE_CHILD_COUNT,
  RT_NODE_KIND: NODE_KIND,
  RT_INSTANCE_WORDS: INSTANCE_WORDS,
  RT_WORLD_WORDS: 16,
  RT_TRIANGLE_FLOATS: PROXY_TRIANGLE_FLOATS,
})}
struct RuntimeProxy{
 instances:u32,instancesWord:u32,surfacesWord:u32,trianglesWord:u32,
 copyWorldsWord:u32,boundsWord:u32,childrenWord:u32,treeRoot:u32,
 treeFirst:u32,treeWord:u32,membersWord:u32,members:u32,
 worldsWord:u32,worldRows:u32,error:f32,copies:u32,
 words:array<u32>,
}
@group(${group}) @binding(${proxy}) var<storage,read> rtProxy:RuntimeProxy;
/** The ray's spending: box tests and node visits in \`rtWork\`, triangle tests in \`rtTests\`. */
var<private> rtWork:u32;
var<private> rtTests:u32;
/** The work of the shadow rays a hit's lighting cast (\`rtBlocked\`), which the ray that hit is charged. */
var<private> rtExtra:u32;
/** Whether \`rtScene\` answers the first surface it meets, not the nearest (\`rtBlocked\`). */
var<private> rtAnyHit:bool;
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
})}
/** Placement \`w\`'s world: its linear columns \`a\`, \`b\`, \`c\` and its translation \`t\`. */
struct RtWorld{a:vec3f,b:vec3f,c:vec3f,t:vec3f,}
fn rtWorldOf(w:u32)->RtWorld{
 // A placement's world is the culling's, mirrored in the proxy's buffer; a blended copy's, the proxy's own,
 // past the placements.
 let at=select(rtProxy.worldsWord+w*RT_WORLD_WORDS,rtProxy.copyWorldsWord+(w-rtProxy.instances)*RT_WORLD_WORDS,w>=rtProxy.instances);
 return RtWorld(
  vec3f(rtFloat(at),rtFloat(at+1u),rtFloat(at+2u)),
  vec3f(rtFloat(at+4u),rtFloat(at+5u),rtFloat(at+6u)),
  vec3f(rtFloat(at+8u),rtFloat(at+9u),rtFloat(at+10u)),
  vec3f(rtFloat(at+12u),rtFloat(at+13u),rtFloat(at+14u)));
}
/** The rows of the inverse of a world's linear part, over its determinant: \`inverse * v\` is the dot
 *  of each with \`v\`. Zero where the world is singular. */
struct RtInverse{r0:vec3f,r1:vec3f,r2:vec3f,}
fn rtInverseOf(m:RtWorld)->RtInverse{
 let r0=cross(m.b,m.c);
 let det=dot(m.a,r0);
 if(abs(det)<1e-30){return RtInverse(vec3f(0.0),vec3f(0.0),vec3f(0.0));}
 let scale=1.0/det;
 return RtInverse(r0*scale,cross(m.c,m.a)*scale,cross(m.a,m.b)*scale);
}
fn rtInverseApply(i:RtInverse,v:vec3f)->vec3f{return vec3f(dot(i.r0,v),dot(i.r1,v),dot(i.r2,v));}
fn rtInstanceWord(w:u32,k:u32)->u32{return rtProxy.words[rtProxy.instancesWord+w*RT_INSTANCE_WORDS+k];}
/** The ray against placement \`w\`: its world box, the root of its cut's tree through the world, first —
 *  a ray that misses it is one unit spent — then the cut's tree with the ray taken to its space. */
fn rtEnter(w:u32,origin:vec3f,direction:vec3f,inverse:vec3f,best:RtHit)->RtHit{
 let node0=rtInstanceWord(w,0u);
 if(node0==RT_NONE||(w<rtProxy.instances&&w>=rtProxy.worldRows)){return best;}
 let m=rtWorldOf(w);
 let local=rtBox(node0);
 let centre=(local.low+local.high)*0.5;
 let half=(local.high-local.low)*0.5;
 let c=m.a*centre.x+m.b*centre.y+m.c*centre.z+m.t;
 let extent=abs(m.a)*half.x+abs(m.b)*half.y+abs(m.c)*half.z;
 if(rayBoxEntry(c-extent,c+extent,origin,inverse,best.distance)>best.distance){return best;}
 let back=rtInverseOf(m);
 let o=rtInverseApply(back,origin-m.t);
 let d=rtInverseApply(back,direction);
 let hit=rtTraceCut(o,d,best.distance,node0,rtInstanceWord(w,1u),w);
 if(hit.found&&hit.distance<best.distance){return hit;}
 return best;
}
fn rtTreeWord(node:u32,field:u32)->u32{return rtProxy.words[rtProxy.treeWord+(node-rtProxy.treeFirst)*RT_TREE_FLOATS+field];}
fn rtTreeLow(node:u32)->vec3f{
 let at=rtProxy.treeWord+(node-rtProxy.treeFirst)*RT_TREE_FLOATS+RT_NODE_MIN;
 return vec3f(rtFloat(at),rtFloat(at+1u),rtFloat(at+2u));
}
fn rtTreeHigh(node:u32)->vec3f{
 let at=rtProxy.treeWord+(node-rtProxy.treeFirst)*RT_TREE_FLOATS+RT_NODE_MAX;
 return vec3f(rtFloat(at),rtFloat(at+1u),rtFloat(at+2u));
}
/** The nearest hit of the ray over every placement that draws a proxy, within \`limit\`: the
 *  placement tree walked depth first, a child entered when its box is met, a group's members one by one.
 *  \`found\` is false past the budget, with the ray's counters spent: ask \`rtSpent\`. A packing with no
 *  tree holds a few placements, tried in turn. */
fn rtScene(origin:vec3f,direction:vec3f,limit:f32)->RtHit{
 var best=RtHit(limit,0u,0u,false);
 if(rtProxy.instances==0u){return best;}
 let inverse=rayInverseDirection(direction);
 if(rtProxy.treeRoot==RT_NONE){
  for(var w=0u;w<rtProxy.members;w++){
   if(rtSpent()){break;}
   rtWork+=1u;
   best=rtEnter(w,origin,direction,inverse,best);
   if(rtAnyHit&&best.found){return best;}
  }
 }else{
  var at:array<u32,RT_TREE_DEPTH>;
  var next:array<u32,RT_TREE_DEPTH>;
  var level=0u;
  var done=false;
  at[0]=rtProxy.treeRoot;
  next[0]=0u;
  for(var step=0u;step<RT_TREE_STEPS;step++){
   if(rtSpent()){done=true;break;}
   let node=at[level];
   let count=rtTreeWord(node,RT_NODE_COUNT);
   let k=next[level];
   if(k>=count){
    if(level==0u){done=true;break;}
    level--;
    continue;
   }
   next[level]=k+1u;
   rtWork+=1u;
   let first=rtTreeWord(node,RT_NODE_FIRST);
   if(rtTreeWord(node,RT_NODE_KIND)==RT_TREE_GROUP){
    let w=rtProxy.words[rtProxy.membersWord+first+k];
    if(w!=RT_NONE){
     best=rtEnter(w,origin,direction,inverse,best);
     if(rtAnyHit&&best.found){return best;}
    }
   }else{
    let child=first+k;
    if(rayBoxEntry(rtTreeLow(child),rtTreeHigh(child),origin,inverse,best.distance)<=best.distance&&level+1u<RT_TREE_DEPTH){
     level++;
     at[level]=child;
     next[level]=0u;
    }
   }
  }
  // A walk that ran out of steps, not of tree, is a spent ray as well: it answers nothing.
  if(!done){rtWork=RT_WORK;}
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
 *  ray the lighting is cast for (\`rtExtra\`). A ray that spends its budget reports no blocker, which lights what
 *  should be dark and never darkens what should be lit. */
fn rtBlocked(origin:vec3f,direction:vec3f,span:f32)->bool{
 let work=rtWork;
 let tests=rtTests;
 rtWork=0u;
 rtTests=0u;
 rtAnyHit=true;
 let hit=rtScene(origin,direction,span);
 rtAnyHit=false;
 rtExtra+=rtWork;
 rtWork=work;
 rtTests=tests;
 return hit.found;
}
`,
  )
