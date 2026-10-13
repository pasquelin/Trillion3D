import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { byteOf } from '../../../math/src/wgsl/integer.ts'
import {
  rayBoxEntry,
  rayInverseDirection,
  rayTriangleDistance,
} from '../../../math/src/wgsl/geometry.ts'
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
import { BOUNCE_NODE_WGSL, wideNodeFns } from './nodeWgsl.ts'
import { BOUNCE_TRACE_WGSL, wideTraversal } from './traceWgsl.ts'
import { SURFACE_RAY_WGSL } from './surfaceRayWgsl.ts'
import { RUNTIME_ANSWER_WGSL } from './runtimeAnswerWgsl.ts'
import {
  FRAME_WORK,
  INSTANCE_WORDS,
  RAY_LAYERS,
  RAY_TRIANGLES,
  RAY_WORK,
  RUNTIME_NONE,
  STORE_BITS,
  SURFACE_BLENDED,
  SURFACE_WORDS,
  TRACE_LIST,
} from './runtimeLayout.ts'

/** The bindings of the run-time proxy in the program that casts its rays: its own buffer, the
 *  culling's nodes and cold table (the placement tree and its member order), the world matrices
 *  of the first range (`gpu/dag/frameRanges.ts`), the trace's list with the frame's counters and the store of
 *  the answers (`runtimeLayout.ts`). */
export type RuntimeBindings = {
  group: number
  proxy: number
  nodes: number
  cold: number
  worlds: number
  list: number
  store: number
}

/** Tree levels a ray walks down at most: a tree of 64-way nodes holds 2⁴² members in seven. */
const TREE_DEPTH = 8

/**
 * THE RUN-TIME PROXY'S RAYS: what a reflection meets of the meshes the world cut at run time, which
 * carry no cooked proxy. One traversal over two levels: the culling's placement tree — its nodes
 * hold the world boxes of up to 64 children, a group's children being placements — and, in each
 * placement whose box the ray meets, its cut's own wide tree (`rtTraceCut`, the engine's one wide
 * traversal, `wideTraversal`) in the cut's own space, the ray taken there by the inverse of the
 * placement's world. The world is the culling's, read where it lies: nothing is copied per
 * placement but a four-word instance (`runtimeLayout.ts`).
 *
 * ONE BUDGET A RAY (`RAY_WORK`, `RAY_TRIANGLES`): every box tested at either level, every node
 * visited and every triangle spends from the same counters; a ray that spends them is `exhausted`
 * and answers nothing (`rtScene`, `rtRadiance`): the next stage of the chain answers, never a miss.
 *
 * `rtRadiance` is the radiance a ray brings back, through up to `RAY_LAYERS` surfaces — a blended one
 * lets the rest of the light through (its opacity weighs its own radiance, the transmittance goes on)
 * —, and the confidence of the answer: what it holds, the rest left to the next stage. The radiance
 * of a surface is its emission and its diffuse tint lit as the proxy's other surfaces are
 * (`surfaceLit`), the shadows traced against the cooked proxy alone. A cut whose placement deforms is
 * traced at its rest shape, its confidence cut by the placement's reach against the footprint.
 */
export const runtimeTraceWgsl = ({
  group,
  proxy,
  nodes,
  cold,
  worlds,
  list,
  store,
}: RuntimeBindings) =>
  wgslBlock(
    `runtimeTraceWgsl(${group}, ${proxy}, ${nodes}, ${cold}, ${worlds}, ${list}, ${store})`,
    [
      BOUNCE_NODE_WGSL,
      BOUNCE_TRACE_WGSL,
      SURFACE_RAY_WGSL,
      byteOf,
      rayBoxEntry,
      rayInverseDirection,
      rayTriangleDistance,
    ],
    `
${wgslConsts({
  RT_NONE: RUNTIME_NONE,
  RT_WORK: RAY_WORK,
  RT_TRIANGLES: RAY_TRIANGLES,
  RT_LAYERS: RAY_LAYERS,
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
  RT_SURFACE_BLENDED: SURFACE_BLENDED,
  RT_INSTANCE_WORDS: INSTANCE_WORDS,
  RT_WORLD_WORDS: 16,
  RT_FRAME_WORK: FRAME_WORK,
  RT_LEFT: TRACE_LIST.left,
  RT_SPENT: TRACE_LIST.spent,
  RT_OFFSET: TRACE_LIST.offset,
  RT_CURSOR: TRACE_LIST.cursor,
  RT_CONFIDENCE_MAX: 2 ** STORE_BITS.confidence - 1,
  RT_STAMP_SHIFT: STORE_BITS.stamp,
  RT_SURFACE_WORDS: SURFACE_WORDS,
  RT_TRIANGLE_FLOATS: PROXY_TRIANGLE_FLOATS,
})}
struct RuntimeProxy{
 instances:u32,instancesWord:u32,surfacesWord:u32,trianglesWord:u32,
 copyWorldsWord:u32,boundsWord:u32,childrenWord:u32,treeRoot:u32,
 membersWord:u32,members:u32,worldStride:u32,worldRows:u32,
 error:f32,nodeFirst:u32,coldFirst:u32,copies:u32,
 words:array<u32>,
}
@group(${group}) @binding(${proxy}) var<storage,read> rtProxy:RuntimeProxy;
@group(${group}) @binding(${nodes}) var<storage,read> rtNodes:array<u32>;
@group(${group}) @binding(${cold}) var<storage,read> rtCold:array<u32>;
@group(${group}) @binding(${worlds}) var<storage,read> rtWorlds:array<f32>;
@group(${group}) @binding(${list}) var<storage,read_write> rtList:array<atomic<u32>>;
@group(${group}) @binding(${store}) var rtStore:texture_storage_2d_array<r32uint,read_write>;
/** The ray's spending: box tests and node visits in \`rtWork\`, triangle tests in \`rtTests\`. */
var<private> rtWork:u32;
var<private> rtTests:u32;
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
     if(distance<best.distance){best=RtHit(distance,placement,tri0+index,true);}`,
  answer: 'best',
})}
/** Placement \`w\`'s world: its linear columns \`a\`, \`b\`, \`c\` and its translation \`t\`. */
struct RtWorld{a:vec3f,b:vec3f,c:vec3f,t:vec3f,}
fn rtWorldOf(w:u32)->RtWorld{
 // A placement's world is the culling's; a blended copy's, the proxy's own, past the placements.
 if(w>=rtProxy.instances){
  let at=rtProxy.copyWorldsWord+(w-rtProxy.instances)*RT_WORLD_WORDS;
  return RtWorld(
   vec3f(rtFloat(at),rtFloat(at+1u),rtFloat(at+2u)),
   vec3f(rtFloat(at+4u),rtFloat(at+5u),rtFloat(at+6u)),
   vec3f(rtFloat(at+8u),rtFloat(at+9u),rtFloat(at+10u)),
   vec3f(rtFloat(at+12u),rtFloat(at+13u),rtFloat(at+14u)));
 }
 let base=w*rtProxy.worldStride;
 return RtWorld(
  vec3f(rtWorlds[base],rtWorlds[base+1u],rtWorlds[base+2u]),
  vec3f(rtWorlds[base+4u],rtWorlds[base+5u],rtWorlds[base+6u]),
  vec3f(rtWorlds[base+8u],rtWorlds[base+9u],rtWorlds[base+10u]),
  vec3f(rtWorlds[base+12u],rtWorlds[base+13u],rtWorlds[base+14u]));
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
fn rtTreeWord(node:u32,field:u32)->u32{return rtNodes[(node-rtProxy.nodeFirst)*RT_TREE_FLOATS+field];}
fn rtTreeLow(node:u32)->vec3f{
 let at=(node-rtProxy.nodeFirst)*RT_TREE_FLOATS+RT_NODE_MIN;
 return vec3f(bitcast<f32>(rtNodes[at]),bitcast<f32>(rtNodes[at+1u]),bitcast<f32>(rtNodes[at+2u]));
}
fn rtTreeHigh(node:u32)->vec3f{
 let at=(node-rtProxy.nodeFirst)*RT_TREE_FLOATS+RT_NODE_MAX;
 return vec3f(bitcast<f32>(rtNodes[at]),bitcast<f32>(rtNodes[at+1u]),bitcast<f32>(rtNodes[at+2u]));
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
    let w=rtCold[rtProxy.membersWord-rtProxy.coldFirst+first+k];
    if(w!=RT_NONE){best=rtEnter(w,origin,direction,inverse,best);}
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
 }
 return best;
}
/** What a ray brings back: the radiance of what it met, weighed by the confidence of the answer. */
struct RtRadiance{color:vec3f,confidence:f32,}
/** A surface's words (\`runtimeLayout.ts\`): its diffuse tint and opacity, its emission and its flags. */
struct RtSurface{tint:vec3f,opacity:f32,emission:vec3f,blended:bool,}
fn rtSurfaceOf(index:u32)->RtSurface{
 let base=rtProxy.surfacesWord+index*RT_SURFACE_WORDS;
 return RtSurface(
  vec3f(rtFloat(base),rtFloat(base+1u),rtFloat(base+2u)),rtFloat(base+3u),
  vec3f(rtFloat(base+4u),rtFloat(base+5u),rtFloat(base+6u)),
  (rtProxy.words[base+7u]&RT_SURFACE_BLENDED)!=0u);
}
/** The radiance of the surface a hit is on, seen from \`direction\`: its emission, and its tint lit at
 *  the point by the lights (\`surfaceLit\`), on the face that looks at the ray. */
fn rtShade(hit:RtHit,origin:vec3f,direction:vec3f,surface:RtSurface,reach:f32)->vec3f{
 let w=hit.placement;
 let m=rtWorldOf(w);
 let back=rtInverseOf(m);
 let n=cross(rtVertex(hit.triangle,1u)-rtVertex(hit.triangle,0u),rtVertex(hit.triangle,2u)-rtVertex(hit.triangle,0u));
 var N=normalize(back.r0*n.x+back.r1*n.y+back.r2*n.z);
 if(dot(N,direction)>0.0){N=-N;}
 return surface.emission+surfaceLit(surface.tint,origin+direction*hit.distance,N,reach);
}
/**
 * The run-time proxy's answer to a ray of length \`reach\` from \`origin\`: its first surface, and
 * the ones behind it while the surfaces met let light through, up to \`RT_LAYERS\`. The answer is the
 * radiance of the light they hold, \`confidence\` the share of the ray they stop; the rest goes on to the
 * next stage. \`error\` is the width the ray's lobe covers at a metre, \`tangent\`: a deformed placement's
 * reach, which its rest shape does not hold, takes confidence from a hit narrower than it.
 * Exhausted — the budget spent — is no answer at all, confidence zero.
 */
fn rtRadiance(origin:vec3f,direction:vec3f,reach:f32,tangent:f32)->RtRadiance{
 rtWork=0u;
 rtTests=0u;
 var color=vec3f(0.0);
 var through=1.0;
 var start=origin;
 var left=reach;
 for(var layer=0u;layer<RT_LAYERS;layer++){
  let hit=rtScene(start,direction,left);
  if(rtSpent()){return RtRadiance(vec3f(0.0),0.0);}
  if(!hit.found){break;}
  let surface=rtSurfaceOf(rtInstanceWord(hit.placement,2u));
  let spread=hit.distance*tangent+0.01;
  let marked=unpack2x16float(rtInstanceWord(hit.placement,3u)>>16u).x;
  let known=spread/(spread+marked*length(rtWorldOf(hit.placement).a));
  let opacity=select(1.0,surface.opacity,surface.blended)*known;
  color+=through*opacity*rtShade(hit,start,direction,surface,reach);
  through*=1.0-opacity;
  let travelled=hit.distance+max(rtProxy.error,1e-3);
  start+=direction*travelled;
  left-=travelled;
  if(through<0.02||left<=0.0){break;}
 }
 let held=1.0-through;
 return RtRadiance(select(vec3f(0.0),color/held,held>0.0),held);
}

/** The pixel the trace is at, and the rays it has asked of the proxy for it: the first is the base
 *  lobe's, which keeps its answer in the store (\`rtAnswer\`); a coat's goes without. */
var<private> rtPixel:vec2u;
var<private> rtRank:u32;
var<private> rtCalls:u32;
${RUNTIME_ANSWER_WGSL}
`,
  )
