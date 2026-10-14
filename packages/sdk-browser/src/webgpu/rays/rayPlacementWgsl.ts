import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { placementRay } from '../../gpu/dag/placementRayWgsl.ts'
import { worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from '../../bounce/traceWgsl.ts'
import { DAG_READ_TABLES_WGSL } from '../../gpu/dag/shader/bindings.ts'
import {
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_FIRST_PAGE,
  NODE_MAX,
  NODE_MIN,
  NODE_PAGE_COUNT,
} from '../../gpu/dag/nodeLayout.ts'
import { TRANSLATION_AT_EYE_WGSL } from '../../gpu/dag/shader/worldPoseWgsl.ts'
import { MARK_WORD, PAGE_BASE_WORD, RECORD_SHIFT_WORD, ROOT_WORD } from '../../gpu/dag/worlds.ts'
import { RAY_PAGE_WGSL } from './rayPageWgsl.ts'
import { FILTER_INCLUDE } from './rayRecord.ts'
import { rayQueryBindingsWgsl } from './deformIndexWgsl.ts'

/** Visits a placement's hierarchy may make, and the nodes its stack holds: a balanced hierarchy of
 *  any width stacks a few of each level it descends. */
const DAG_STEPS = 4096,
  DAG_STACK = 64

/**
 * The bindings of the ray query. Group 0 binds the cut's record tables where the culling reads
 * them, at its bindings and under its names (`../../gpu/dag/shader/bindings.ts`,
 * `DAG_READ_TABLES_WGSL`): its nodes, every placement's frame words and world, and the placement
 * tree, its nodes and its member order. Group 1 binds the query's uniform and buffer
 * (`rayQueryBindingsWgsl`), the geometry pool's words and the float pool: three storage buffers and
 * four sampled textures, whatever the world's size — one dispatch a batch.
 */
const RAY_TABLES_WGSL = wgslBlock(
  'RAY_TABLES_WGSL',
  [DAG_READ_TABLES_WGSL, rayQueryBindingsWgsl(1, false)],
  `@group(1) @binding(2) var<storage,read> indices:array<u32>;
@group(1) @binding(3) var<storage,read> positions:array<f32>;`,
)

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
/** Column \`c\` of placement \`w\`'s world, in its record (\`worldsMatrix\`). */
fn rqColumn(w:u32,c:u32)->vec4f{return bitcast<vec4f>(worldsMatrix(w,c));}
fn rqLinear(w:u32)->mat3x3f{return mat3x3f(rqColumn(w,0u).xyz,rqColumn(w,1u).xyz,rqColumn(w,2u).xyz);}
/** Its world with the translation at the eye \`e0\`, \`e1\`, from the exact one beside the matrix
 *  (\`worldsOrigin\`). */
fn rqWorld(w:u32,e0:vec4u,e1:vec4u)->mat4x4f{
 let t=bitcast<vec3f>(translationAtEye(worldsOrigin(w,0u),worldsOrigin(w,1u),e0,e1));
 return mat4x4f(rqColumn(w,0u),rqColumn(w,1u),rqColumn(w,2u),vec4f(t,rqColumn(w,3u).w));
}
fn rqNodeLow(n:u32)->vec3f{return bitcast<vec3f>(vec3u(nodesWord(n,RQ_NODE_MIN),nodesWord(n,RQ_NODE_MIN+1u),nodesWord(n,RQ_NODE_MIN+2u)));}
fn rqNodeHigh(n:u32)->vec3f{return bitcast<vec3f>(vec3u(nodesWord(n,RQ_NODE_MAX),nodesWord(n,RQ_NODE_MAX+1u),nodesWord(n,RQ_NODE_MAX+2u)));}
fn rqBox(n:u32,reach:f32)->Box{return Box(rqNodeLow(n)-vec3f(reach),rqNodeHigh(n)+vec3f(reach));}
/** Child \`slot\` of node \`n\`: a node with children of its own is entered, one without them is a
 *  leaf whose pages — counted from the placement's first, \`pageBase\` — are tested, as the cut
 *  deposits them (\`../../gpu/dag/shader/levelWgsl.ts\`); a leaf with no page holds nothing. */
fn rqChild(n:u32,slot:u32,reach:f32,pageBase:u32)->ProxyChild{
 let c=nodesWord(n,RQ_FIRST_CHILD)+slot;
 let leaf=nodesWord(c,RQ_CHILD_COUNT)==0u;
 let pageCount=nodesWord(c,RQ_PAGE_COUNT);
 return ProxyChild(rqBox(c,reach),select(c,pageBase+nodesWord(c,RQ_FIRST_PAGE),leaf),select(0u,pageCount,leaf),!leaf||pageCount>0u);
}`,
)

/**
 * THE RAY AGAINST ONE PLACEMENT: its hierarchy walked by the engine's one wide traversal
 * (`wideTraversal`), nearest child first, in the placement's own space — the ray taken there by the
 * inverse of its world at the ray's origin, as every ray walking the placement tree takes it
 * (`placementRay`, `../../gpu/dag/placementRayWgsl.ts`) — each leaf's pages tested as the rasters draw them
 * (`rqPage`). A placement the ray's filter passes by, the world DAG's, one parked or hidden (its root
 * none) or a singular world holds nothing a ray meets. A stack or a walk past its bound marks the
 * ray cut short (`rqCut`).
 */
export const RAY_PLACEMENT_WGSL = wgslBlock(
  'RAY_PLACEMENT_WGSL',
  [RAY_TABLES_WGSL, RAY_NODES_WGSL, RAY_PAGE_WGSL, NO_INDEX, placementRay, worldMatrix3],
  `${wgslConsts({
    RQ_ROOT_WORD: ROOT_WORD,
    RQ_SHIFT_WORD: RECORD_SHIFT_WORD,
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
  params: ',root:u32,pageBase:u32,shift:u32,reach:f32,w:u32',
  returns: 'RqHit',
  start: 'var best=RqHit(limit,0u,0u,0u,vec3f(0.0),false);',
  empty: '',
  root: 'root',
  steps: 'RQ_DAG_STEPS',
  box: 'rqBox(node,reach)',
  child: 'rqChild(node,slot,reach,pageBase)',
  children: 'nodesWord(node,RQ_CHILD_COUNT)',
  leaf: 'child.count',
  stack: DAG_STACK,
  visit: '',
  stop: '',
  test: 'best=rqPage(origin,direction,index,index+shift,w,best);',
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
 let root=framesWord(w,RQ_ROOT_WORD);
 if(root==NO_INDEX){return best;}
 let m=rqWorld(w,ray.eyeXY,vec4u(ray.eyeZ,0u,0u));
 // The origin is the eye: at zero, the placement at its translation from it.
 let placed=placementRay(worldMatrix3(m),-m[3].xyz,ray.direction);
 if(!placed.regular){return best;}
 let reach=unpack2x16float(framesWord(w,RQ_MARK_WORD)).y;
 let pageBase=framesWord(w,RQ_PAGE_BASE_WORD);
 let shift=framesWord(w,RQ_SHIFT_WORD);
 var hit=RqHit(best.distance,0u,0u,0u,vec3f(0.0),false);
 if(nodesWord(root,RQ_CHILD_COUNT)!=0u){hit=rqDag(placed.origin,placed.direction,best.distance,root,pageBase,shift,reach,w);}
 else{
  let first=pageBase+nodesWord(root,RQ_FIRST_PAGE);
  for(var k=0u;k<nodesWord(root,RQ_PAGE_COUNT);k++){hit=rqPage(placed.origin,placed.direction,first+k,first+k+shift,w,hit);}
 }
 if(hit.found&&hit.distance<best.distance){return hit;}
 return best;
}`,
)
