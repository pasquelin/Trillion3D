import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { placementRay } from '../../geometry/dag/placement/placementRayWgsl.ts'
import { matrixWindingCw, worldMatrix3 } from '../../../../math/src/wgsl/matrix.ts'
import { NO_INDEX } from '../../../../math/src/wgsl/constants.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from './wideTraversalWgsl.ts'
import { DAG_READ_TABLES_WGSL } from '../../geometry/dag/shader/bindings.ts'
import {
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_FIRST_PAGE,
  NODE_PAGE_COUNT,
} from '../../geometry/dag/nodeLayout.ts'
import { worldAtEyeWgsl } from '../../geometry/dag/shader/worldPoseWgsl.ts'
import {
  MARK_WORD,
  PAGE_BASE_WORD,
  RECORD_SHIFT_WORD,
  ROOT_WORD,
} from '../../geometry/dag/frameTable.ts'
import { markReachWgsl } from '../../deformation/halfFloat.ts'
import { RAY_PAGE_WGSL } from './rayPageWgsl.ts'
import { FILTER_INCLUDE } from './rayRecord.ts'
import { rayQueryBindingsWgsl } from './deformIndexWgsl.ts'
import { WORLD_ROOT_MARK } from '../../geometry/dag/worlds/worldLinks.ts'

/** Visits a placement's hierarchy may make, and the nodes its stack holds: a balanced hierarchy of
 *  any width stacks a few of each level it descends. */
const DAG_STEPS = 4096,
  DAG_STACK = 64

/**
 * The bindings of the ray query. Group 0 binds the cut's record tables where the culling reads
 * them, at its bindings and under its names (`../../geometry/dag/shader/bindings.ts`,
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

/** The boxes and children of a placement's hierarchy's nodes, each box grown by its deformation's
 *  reach as the cut grows it, its corners read by the nodes table's own reader (`nodesLow`,
 *  `nodesHigh`). */
const RAY_NODES_WGSL = wgslBlock(
  'RAY_NODES_WGSL',
  [DAG_READ_TABLES_WGSL, WIDE_TRAVERSAL_WGSL],
  `${wgslConsts({
    RQ_FIRST_CHILD: NODE_FIRST_CHILD,
    RQ_CHILD_COUNT: NODE_CHILD_COUNT,
    RQ_FIRST_PAGE: NODE_FIRST_PAGE,
    RQ_PAGE_COUNT: NODE_PAGE_COUNT,
  })}
fn rqBox(n:u32,reach:f32)->Box{return Box(nodesLow(n)-vec3f(reach),nodesHigh(n)+vec3f(reach));}
/** Child \`slot\` of node \`n\`: a node with children of its own is entered, one without them is a
 *  leaf whose pages — counted from the placement's first, \`pageBase\` — are tested, as the cut
 *  deposits them (\`../../gpu/dag/shader/levelWgsl.ts\`); a leaf with no page holds nothing. */
fn rqChild(n:u32,slot:u32,reach:f32,pageBase:u32)->WideChild{
 let c=nodesWord(n,RQ_FIRST_CHILD)+slot;
 let leaf=nodesWord(c,RQ_CHILD_COUNT)==0u;
 let pageCount=nodesWord(c,RQ_PAGE_COUNT);
 return WideChild(rqBox(c,reach),select(c,pageBase+nodesWord(c,RQ_FIRST_PAGE),leaf),select(0u,pageCount,leaf),!leaf||pageCount>0u);
}`,
)

/**
 * THE RAY ENTERING A PLACEMENT, for every ray that walks the placement tree (`placementEnter`): the
 * placement `w`'s root and mark words, its world at the eye `eyeXY`, `eyeZ` (three doubles, as a
 * ray holds its origin), and the ray taken into its space by the inverse of that world
 * (`placementRay`) — `offset` the ray's origin from the eye, `direction` its direction. The entry
 * says the world it took, the ray there, the root, the mark word and the deformation reach it
 * carries (`markReach`), whether the world mirrors (`matrixWindingCw`), and whether there is
 * anything to enter (`found`): a placement parked or hidden (its root none) or a singular world
 * holds nothing a ray meets, and the first is turned back before its world is read.
 */
export const PLACEMENT_ENTER_WGSL = wgslBlock(
  'PLACEMENT_ENTER_WGSL',
  [
    DAG_READ_TABLES_WGSL,
    worldAtEyeWgsl('worlds'),
    placementRay,
    worldMatrix3,
    matrixWindingCw,
    markReachWgsl,
    NO_INDEX,
  ],
  `${wgslConsts({
    PE_ROOT_WORD: ROOT_WORD,
    PE_MARK_WORD: MARK_WORD,
  })}
struct PlacementEntry{world:mat4x4f,origin:vec3f,direction:vec3f,root:u32,mark:u32,reach:f32,mirrored:bool,found:bool,}
fn placementEnter(w:u32,eyeXY:vec4u,eyeZ:vec2u,offset:vec3f,direction:vec3f)->PlacementEntry{
 let root=framesWord(w,PE_ROOT_WORD);
 let mark=framesWord(w,PE_MARK_WORD);
 var entry=PlacementEntry(mat4x4f(),vec3f(0.0),vec3f(0.0),root,mark,markReach(mark),false,false);
 if(root==NO_INDEX){return entry;}
 let m=worldsWorldAtEye(w,eyeXY,vec4u(eyeZ,0u,0u));
 let placed=placementRay(worldMatrix3(m),offset-m[3].xyz,direction);
 entry.world=m;
 entry.origin=placed.origin;
 entry.direction=placed.direction;
 entry.mirrored=matrixWindingCw(m);
 entry.found=placed.regular;
 return entry;
}`,
)

/**
 * THE RAY AGAINST ONE PLACEMENT: its hierarchy walked by the engine's one wide traversal
 * (`wideTraversal`), nearest child first, in the placement's own space — the ray taken there by the
 * inverse of its world at the ray's origin, as every ray walking the placement tree takes it
 * (`placementRay`, `../../geometry/dag/placement/placementRayWgsl.ts`) — each leaf's pages tested as the rasters
 * draw them (`rqPage`), each box grown by how near a line the ray meets it (`lineReach`, taken to
 * the placement's space by the length its direction takes there). A placement the ray's filter
 * passes by, the world DAG's, one parked or hidden (its root none) or a singular world holds
 * nothing a ray meets. A stack or a walk past its bound marks the ray cut short (`rqCut`).
 */
export const RAY_PLACEMENT_WGSL = wgslBlock(
  'RAY_PLACEMENT_WGSL',
  [RAY_TABLES_WGSL, worldAtEyeWgsl('worlds'), RAY_NODES_WGSL, RAY_PAGE_WGSL, PLACEMENT_ENTER_WGSL],
  `${wgslConsts({
    RQ_SHIFT_WORD: RECORD_SHIFT_WORD,
    RQ_WORLD_ROOT: WORLD_ROOT_MARK,
    RQ_PAGE_BASE_WORD: PAGE_BASE_WORD,
    RQ_FILTER_INCLUDE: FILTER_INCLUDE,
    RQ_FILTER_COUNT: FILTER_INCLUDE - 1,
    RQ_DAG_STEPS: DAG_STEPS,
  })}
/** Whether the walk of a ray was cut short by a bound. */
var<private> rqCut:bool;
struct RqRay{eyeXY:vec4u,eyeZ:vec2u,filterFirst:u32,filterWord:u32,direction:vec3f,reach:f32,lineReach:f32,}
${wideTraversal({
  name: 'rqDag',
  params: ',root:u32,pageBase:u32,shift:u32,reach:f32,lineReach:f32,w:u32',
  returns: 'RqHit',
  start: 'var best=RqHit(limit,0u,0u,0u,vec3f(0.0),false);',
  empty: '',
  root: 'root',
  steps: 'RQ_DAG_STEPS',
  box: 'rqBox(node,reach+lineReach)',
  child: 'rqChild(node,slot,reach+lineReach,pageBase)',
  children: 'nodesWord(node,RQ_CHILD_COUNT)',
  leaf: 'child.count',
  stack: DAG_STACK,
  visit: '',
  stop: '',
  test: 'best=rqPage(origin,direction,lineReach,index,index+shift,w,best);',
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
/** The nearer of \`best\` and what the ray meets of placement \`w\`: none of the world DAG's
 *  (\`WORLD_ROOT_MARK\`), whose objects their own placements hold. */
fn rqEnter(w:u32,ray:RqRay,best:RqHit)->RqHit{
 if((framesWord(w,PE_MARK_WORD)&RQ_WORLD_ROOT)!=0u||!rqAdmits(w,ray.filterFirst,ray.filterWord)){return best;}
 // The origin is the eye: at zero, the placement at its translation from it.
 let entry=placementEnter(w,ray.eyeXY,ray.eyeZ,vec3f(0.0),ray.direction);
 if(!entry.found){return best;}
 // A world length in the placement's space: the unit world direction's length there.
 let lineReach=ray.lineReach*length(entry.direction);
 let pageBase=framesWord(w,RQ_PAGE_BASE_WORD);
 let shift=framesWord(w,RQ_SHIFT_WORD);
 var hit=RqHit(best.distance,0u,0u,0u,vec3f(0.0),false);
 if(nodesWord(entry.root,RQ_CHILD_COUNT)!=0u){hit=rqDag(entry.origin,entry.direction,best.distance,entry.root,pageBase,shift,entry.reach,lineReach,w);}
 else{
  let first=pageBase+nodesWord(entry.root,RQ_FIRST_PAGE);
  for(var k=0u;k<nodesWord(entry.root,RQ_PAGE_COUNT);k++){hit=rqPage(entry.origin,entry.direction,lineReach,first+k,first+k+shift,w,hit);}
 }
 if(hit.found&&hit.distance<best.distance){return hit;}
 return best;
}`,
)
