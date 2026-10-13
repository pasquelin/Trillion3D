import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { invTranspose3Prep } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from '../../bounce/traceWgsl.ts'
import {
  coldTableBlock,
  nodeTableBlock,
  rangeReader,
  type TableLayout,
} from '../../gpu/dag/cutTablesWgsl.ts'
import {
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_FIRST_PAGE,
  NODE_MAX,
  NODE_MIN,
  NODE_PAGE_COUNT,
} from '../../gpu/dag/nodeLayout.ts'
import { TRANSLATION_AT_EYE_WGSL } from '../../gpu/dag/shader/worldPoseWgsl.ts'
import { FRAME_ROW_WORDS } from '../../gpu/dag/types.ts'
import { MARK_WORD, PAGE_BASE_WORD, ROOT_WORD } from '../../gpu/dag/worlds.ts'
import { RAY_PAGE_WGSL } from './rayPageWgsl.ts'
import { FILTER_INCLUDE } from './rayRecord.ts'
import { rayQueryBindingsWgsl } from './rowHashWgsl.ts'

/** How a device lays out the cut's tables a ray reads: `nodes` and `cold` in their parts, and each
 *  range of placements, its first and its count (`../../gpu/dag/frameRanges.ts`). */
export type RayLayout = {
  nodes: TableLayout
  cold: TableLayout
  ranges: readonly { first: number; count: number }[]
}

/** Visits a placement's hierarchy may make, and the nodes its stack holds: a balanced hierarchy of
 *  any width stacks a few of each level it descends. */
const DAG_STEPS = 4096,
  DAG_STACK = 64

/** The bindings of the ray query on `layout`: the cut's tables in group 0, at the cut's own bindings
 *  (`../../gpu/dag/cutTablesWgsl.ts`); in group 1 the query's uniform and buffer, the page table
 *  (`rayQueryBindingsWgsl`), the geometry pool's words, the float pool, then each range's frames and
 *  worlds, read through `rqFrame`, `rqMatrix` and `rqOrigin`. */
function rayTablesWgsl(layout: RayLayout) {
  const counts = { nodes: layout.nodes.parts, cold: layout.cold.parts },
    firsts = layout.ranges.map(({ first }) => first)
  const declare = (binding: number, name: string) =>
    `@group(1) @binding(${binding}) var<storage,read> ${name}:array<u32>;`
  return wgslBlock(
    `rayTablesWgsl(${JSON.stringify(layout)})`,
    [
      nodeTableBlock(layout.nodes, 0, false, counts),
      coldTableBlock(layout.cold, 0, counts),
      rayQueryBindingsWgsl(1, false),
    ],
    `${declare(3, 'indices')}
@group(1) @binding(4) var<storage,read> positions:array<f32>;
${layout.ranges.map((_, r) => `${declare(5 + 2 * r, `frames${r}`)}\n${declare(6 + 2 * r, `worlds${r}`)}`).join('\n')}
${rangeReader('rqFrame', 'frames', firsts, () => `i*${FRAME_ROW_WORDS}u+k`)}
${rangeReader('rqMatrix', 'worlds', firsts, () => 'i*16u+k')}
${rangeReader('rqOrigin', 'worlds', firsts, (r) => `${layout.ranges[r].count * 16}u+i*8u+k`)}`,
  )
}

/** A placement's world, its linear part and its translation at the ray's origin (the eye `e0`,
 *  `e1`, `TRANSLATION_AT_EYE_WGSL`), and the boxes and children of its hierarchy's nodes, each box
 *  grown by its deformation's reach as the cut grows it. */
const RAY_NODES_WGSL = wgslBlock(
  'RAY_NODES_WGSL',
  [TRANSLATION_AT_EYE_WGSL, WIDE_TRAVERSAL_WGSL],
  `${wgslConsts({
    RQ_NODE_MIN: NODE_MIN,
    RQ_NODE_MAX: NODE_MAX,
    RQ_FIRST_CHILD: NODE_FIRST_CHILD,
    RQ_CHILD_COUNT: NODE_CHILD_COUNT,
    RQ_FIRST_PAGE: NODE_FIRST_PAGE,
    RQ_PAGE_COUNT: NODE_PAGE_COUNT,
  })}
fn rqColumn(w:u32,c:u32)->vec4f{return bitcast<vec4f>(vec4u(rqMatrix(w,4u*c),rqMatrix(w,4u*c+1u),rqMatrix(w,4u*c+2u),rqMatrix(w,4u*c+3u)));}
fn rqLinear(w:u32)->mat3x3f{return mat3x3f(rqColumn(w,0u).xyz,rqColumn(w,1u).xyz,rqColumn(w,2u).xyz);}
fn rqWorld(w:u32,e0:vec4u,e1:vec4u)->mat4x4f{
 let a=vec4u(rqOrigin(w,0u),rqOrigin(w,1u),rqOrigin(w,2u),rqOrigin(w,3u));
 let b=vec4u(rqOrigin(w,4u),rqOrigin(w,5u),0u,0u);
 let t=bitcast<vec3f>(translationAtEye(a,b,e0,e1));
 return mat4x4f(rqColumn(w,0u),rqColumn(w,1u),rqColumn(w,2u),vec4f(t,rqColumn(w,3u).w));
}
fn rqNodeLow(n:u32)->vec3f{return vec3f(bitcast<f32>(nodeWord(n,RQ_NODE_MIN)),bitcast<f32>(nodeWord(n,RQ_NODE_MIN+1u)),bitcast<f32>(nodeWord(n,RQ_NODE_MIN+2u)));}
fn rqNodeHigh(n:u32)->vec3f{return vec3f(bitcast<f32>(nodeWord(n,RQ_NODE_MAX)),bitcast<f32>(nodeWord(n,RQ_NODE_MAX+1u)),bitcast<f32>(nodeWord(n,RQ_NODE_MAX+2u)));}
fn rqBox(n:u32,reach:f32)->Box{return Box(rqNodeLow(n)-vec3f(reach),rqNodeHigh(n)+vec3f(reach));}
/** Child \`slot\` of node \`n\`: a node with children of its own is entered, one without them is a
 *  leaf whose pages — counted from the placement's first, \`pageBase\` — are tested, as the cut
 *  deposits them (\`../../gpu/dag/shader/levelWgsl.ts\`); a leaf with no page holds nothing. */
fn rqChild(n:u32,slot:u32,reach:f32,pageBase:u32)->ProxyChild{
 let c=nodeWord(n,RQ_FIRST_CHILD)+slot;
 let leaf=nodeWord(c,RQ_CHILD_COUNT)==0u;
 let pageCount=nodeWord(c,RQ_PAGE_COUNT);
 return ProxyChild(rqBox(c,reach),select(c,pageBase+nodeWord(c,RQ_FIRST_PAGE),leaf),select(0u,pageCount,leaf),!leaf||pageCount>0u);
}`,
)

/**
 * THE RAY AGAINST ONE PLACEMENT: its hierarchy walked by the engine's one wide traversal
 * (`wideTraversal`), nearest child first, in the placement's own space — the ray taken there by the
 * inverse of its world at the ray's origin, as the proxy's rays take theirs (`rtEnter`,
 * `../../bounce/runtimeSceneWgsl.ts`) — each leaf's pages tested as the rasters draw them
 * (`rqPage`). A placement the ray's filter passes by, the world DAG's, one parked or hidden (its root
 * none) or a singular world holds nothing a ray meets. A stack or a walk past its bound marks the
 * ray cut short (`rqCut`).
 */
export const rayPlacementWgsl = (layout: RayLayout) =>
  wgslBlock(
    `rayPlacementWgsl(${JSON.stringify(layout)})`,
    [rayTablesWgsl(layout), RAY_NODES_WGSL, RAY_PAGE_WGSL, invTranspose3Prep, worldMatrix3],
    `${wgslConsts({
      RQ_NONE: NO_INDEX,
      RQ_ROOT_WORD: ROOT_WORD,
      RQ_MARK_WORD: MARK_WORD,
      RQ_PAGE_BASE_WORD: PAGE_BASE_WORD,
      RQ_FILTER_INCLUDE: FILTER_INCLUDE,
      RQ_FILTER_COUNT: FILTER_INCLUDE - 1,
      RQ_DAG_STEPS: DAG_STEPS,
    })}
/** Whether the walk of a ray was cut short by a bound. */
var<private> rqCut:bool;
struct RqRay{eyeXY:vec4u,eyeZ:vec2u,filterFirst:u32,filterWord:u32,direction:vec3f,reach:f32,}
${wideTraversal({
  name: 'rqDag',
  params: ',root:u32,pageBase:u32,reach:f32,w:u32',
  returns: 'RqHit',
  start: 'var best=RqHit(limit,0u,0u,0u,vec3f(0.0),false);',
  empty: '',
  root: 'root',
  steps: 'RQ_DAG_STEPS',
  box: 'rqBox(node,reach)',
  child: 'rqChild(node,slot,reach,pageBase)',
  children: 'nodeWord(node,RQ_CHILD_COUNT)',
  leaf: 'child.count',
  stack: DAG_STACK,
  visit: '',
  stop: '',
  test: 'best=rqPage(origin,direction,index,w,best);',
  overflow: 'rqCut=true;',
  answer: 'best',
})}
/** Whether the ray's filter lets placement \`w\` be met: listed in its sorted ranks, or not, as its
 *  include bit asks. */
fn rqAdmits(w:u32,first:u32,word:u32)->bool{
 let count=word&RQ_FILTER_COUNT;
 var low=0u;
 var high=count;
 for(var step=0u;step<32u&&low<high;step++){
  let middle=(low+high)/2u;
  if(query[params.filterWord+first+middle]<w){low=middle+1u;}else{high=middle;}
 }
 let listed=low<count&&query[params.filterWord+first+low]==w;
 return listed==((word&RQ_FILTER_INCLUDE)!=0u);
}
/** The nearer of \`best\` and what the ray meets of placement \`w\`. */
fn rqEnter(w:u32,ray:RqRay,best:RqHit)->RqHit{
 if(w==params.worldPlacement||!rqAdmits(w,ray.filterFirst,ray.filterWord)){return best;}
 let root=rqFrame(w,RQ_ROOT_WORD);
 if(root==RQ_NONE){return best;}
 let m=rqWorld(w,ray.eyeXY,vec4u(ray.eyeZ,0u,0u));
 let back=invTranspose3Prep(worldMatrix3(m));
 if(!back.regular){return best;}
 // The origin is the eye: at zero, the placement at its translation from it.
 let o=(-m[3].xyz)*back.adj*back.scale;
 let d=ray.direction*back.adj*back.scale;
 let reach=unpack2x16float(rqFrame(w,RQ_MARK_WORD)).y;
 let pageBase=rqFrame(w,RQ_PAGE_BASE_WORD);
 var hit=RqHit(best.distance,0u,0u,0u,vec3f(0.0),false);
 if(nodeWord(root,RQ_CHILD_COUNT)!=0u){hit=rqDag(o,d,best.distance,root,pageBase,reach,w);}
 else{
  let first=pageBase+nodeWord(root,RQ_FIRST_PAGE);
  for(var k=0u;k<nodeWord(root,RQ_PAGE_COUNT);k++){hit=rqPage(o,d,first+k,w,hit);}
 }
 if(hit.found&&hit.distance<best.distance){return hit;}
 return best;
}`,
  )
