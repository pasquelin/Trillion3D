import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import {
  faceNormal,
  rayBoxEntry,
  rayInverseDirection,
  rayTriangleDistance,
  transformHalfExtent,
} from '../../../../../math/src/wgsl/geometry.ts'
import { pow2FromExponent } from '../../../../../math/src/wgsl/integer.ts'
import { inverseTranspose3, unitOrZero } from '../../../../../math/src/wgsl/inverseTranspose.ts'
import {
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_LEAF_COUNT_SHIFT,
  RAY_TRACING_LEAF_OFFSET_MASK,
  RAY_TRACING_LEAF_TRIANGLES,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_WIDTH,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import { RAY_TRACING_RECORD_WORDS } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { computeBufferEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { reachUnboundedWgsl } from '../../../deformation/halfFloat.ts'
import { CASTS_NO_SHADOW } from '../../../visibility/shader/spriteWgsl.ts'
import { DAG_READ_TABLES_WGSL } from '../../../geometry/dag/shader/bindings.ts'
import { worldAtEyeWgsl } from '../../../geometry/dag/shader/worldPoseWgsl.ts'
import {
  PLACEMENT_TREE_WALK_WGSL,
  placementTreeCast,
  TREE_STEPS,
} from '../../../geometry/dag/tree/treeWalkWgsl.ts'
import { PLACEMENT_ENTER_WGSL } from '../rayPlacementWgsl.ts'
import type { SceneTrace } from './sceneTraceResources.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from '../wideTraversalWgsl.ts'

/** The nodes a primitive's structure's walk keeps for later. */
const BLAS_STACK = 16

/**
 * The scene trace's parameters, one uniform (`sceneTraceResources.ts` writes it): the eye the
 * rays and the placements are taken to — three doubles, as a ray of the ray query holds its origin —,
 * the distance and the tangent of the angle, squared, past which an instance is left out (seen from
 * the eye), the bound on the steps of a trace, the placement tree's top (none without a tree), the
 * placements the packing holds, where in the table buffer the table from a placement to its
 * record begins, and the two distances, in metres, under which a ray that asks it (`ST_SKIP_NEAR`)
 * passes a hit by: a back face of a one-sided primitive, any hit on a two-sided one.
 */
export const SCENE_TRACE_PARAMS = fieldLayout('StParams', [
  ['eyeXY', 'vec4u'],
  ['eyeZ', 'vec2u'],
  ['cullRadius', 'f32'],
  ['tanCullAngle2', 'f32'],
  ['maxIterations', 'u32'],
  ['treeRoot', 'u32'],
  ['placements', 'u32'],
  ['placementWord', 'u32'],
  ['skipBackFaceDistance', 'f32'],
  ['skipTwoSidedDistance', 'f32'],
] as const)

/**
 * The scene trace's declarations in group `group` from binding `first` (`sceneTraceLayoutEntries`
 * is their layout): `stParams`, `stNodes` (five `vec4u` a node), `stTriangles` (three `vec4u` a triangle), `stTable`. The placement tree and the
 * placements' worlds are not here: they are the cut's record tables, listed beside
 * (`DAG_READ_TABLES_WGSL`, group 0 at the culling's bindings).
 */
const sceneTraceBindings = (group: number, first: number) =>
  wgslBlock(
    `sceneTraceBindings(${group},${first})`,
    [],
    `${SCENE_TRACE_PARAMS.wgsl}
@group(${group}) @binding(${first}) var<uniform> stParams:StParams;
@group(${group}) @binding(${first + 1}) var<storage,read> stNodes:array<vec4u>;
@group(${group}) @binding(${first + 2}) var<storage,read> stTriangles:array<vec4u>;
@group(${group}) @binding(${first + 3}) var<storage,read> stTable:array<u32>;`,
  )

/** The layout entries of `sceneTraceBindings` from `first`, and of the cut's tables it reads beside
 *  them: `dagReadLayoutEntries` (`../../../geometry/dag/shader/bindings.ts`), in group 0. */
export const sceneTraceLayoutEntries = (first: number): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(first),
  computeBufferEntry(first + 1, 'read-only-storage'),
  computeBufferEntry(first + 2, 'read-only-storage'),
  computeBufferEntry(first + 3, 'read-only-storage'),
]

/** The bind group entries of `sceneTraceBindings` from `first`, over the resources of `trace`, whose table
 *  `syncPlacements` has made. */
export const sceneTraceBindEntries = (
  trace: Pick<SceneTrace, 'params' | 'nodes' | 'triangles' | 'table'>,
  first: number,
): GPUBindGroupEntry[] =>
  [trace.params, trace.nodes, trace.triangles, trace.table].map((buffer, at) => ({
    binding: first + at,
    resource: { buffer },
  }))

/** What a ray's `flags` choose: the first hit, ignoring the faces toward the ray or those away from it, the shadow
 *  rule (the placements that cast none), the translucent primitives left out, the near hits passed by. */
const SCENE_TRACE_FLAGS = {
  anyHit: 1,
  cullFront: 2,
  shadow: 4,
  cullBack: 8,
  skipTranslucent: 16,
  skipNear: 32,
} as const

const R = RAY_TRACING_RECORD_AT

/** The words and masks the library reads, as the file lays them: a node and a triangle are read as `vec4u`. */
const SCENE_TRACE_CONSTS = wgslConsts({
  ST_NODE_VECS: RAY_TRACING_NODE_BYTES / 16,
  ST_TRIANGLE_VECS: RAY_TRACING_TRIANGLE_BYTES / 16,
  ST_RECORD_WORDS: RAY_TRACING_RECORD_WORDS,
  ST_RECORD_FLAGS: R.flags,
  ST_RECORD_FIRST_NODE: R.firstNode,
  ST_RECORD_NODES: R.nodeCount,
  ST_RECORD_FIRST_TRIANGLE: R.firstTriangle,
  ST_RECORD_BOX_MIN: R.boxMin,
  ST_RECORD_BOX_MAX: R.boxMax,
  ST_WIDTH: RAY_TRACING_WIDTH,
  ST_LEAF_TRIANGLES: RAY_TRACING_LEAF_TRIANGLES,
  ST_LEAF_COUNT_SHIFT: RAY_TRACING_LEAF_COUNT_SHIFT,
  ST_LEAF_OFFSET_MASK: RAY_TRACING_LEAF_OFFSET_MASK,
  ST_TWO_SIDED: RAY_TRACING_FLAG_TWO_SIDED,
  ST_TRANSLUCENT: RAY_TRACING_FLAG_TRANSLUCENT,
  ST_CASTS_NO_SHADOW: CASTS_NO_SHADOW,
  ST_ANY_HIT: SCENE_TRACE_FLAGS.anyHit,
  ST_CULL_FRONT: SCENE_TRACE_FLAGS.cullFront,
  ST_SHADOW: SCENE_TRACE_FLAGS.shadow,
  ST_CULL_BACK: SCENE_TRACE_FLAGS.cullBack,
  ST_SKIP_TRANSLUCENT: SCENE_TRACE_FLAGS.skipTranslucent,
  ST_SKIP_NEAR: SCENE_TRACE_FLAGS.skipNear,
})

/** The constants, the structures and the state of the trace in progress. */
const ST_TYPES = `${SCENE_TRACE_CONSTS}
struct StRay{origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,flags:u32,}
struct StHit{distance:f32,placement:u32,record:u32,triangle:u32,normal:vec3f,frontFace:bool,twoSided:bool,hit:bool,}
/** A node of a primitive's structure: its corner, the size of a quantum along each axis, how far a
 *  rounded box may fall short of the exact one, the children that are nodes, the links, the eight
 *  metas and the children's boxes' bytes, as the file lays them. */
struct StNode{corner:vec3f,scale:vec3f,slack:vec3f,internal:u32,childBase:u32,triangleBase:u32,metas:vec2u,grid0:vec4u,grid1:vec4u,grid2:vec4u,}
/** A placement taken into its primitive's space: its rank, its record, the first node, the nodes and
 *  the first triangle of the record, whether the world mirrors, whether the primitive is two-sided. */
struct StInstance{placement:u32,record:u32,firstNode:u32,nodes:u32,firstTriangle:u32,mirrored:bool,twoSided:bool,}
/** The trace in progress: its ray, whether it is done (a hit of an any-hit ray), whether it is
 *  complete — the answer to read once \`stTrace\` has returned —, and the steps spent. */
var<private> stRay:StRay;
var<private> stDone:bool;
var<private> stComplete:bool;
var<private> stSteps:u32;`

/** The reads of a node of the file, of a child's box and of the table's floats, and the step a triangle met costs. */
const ST_NODE_READS = `/** A triangle met, a step of the trace: false, the trace done and incomplete, once the bound is spent. */
fn stStep()->bool{
 if(stSteps>=stParams.maxIterations){stComplete=false;stDone=true;return false;}
 stSteps++;
 return true;
}
/** The size of a quantum along each axis, a power of two from the three exponent bytes of \`word\`. */
fn stScale(word:u32)->vec3f{
 return vec3f(
  pow2FromExponent(max(bitcast<i32>(word<<24u)>>24u,-126)),
  pow2FromExponent(max(bitcast<i32>(word<<16u)>>24u,-126)),
  pow2FromExponent(max(bitcast<i32>(word<<8u)>>24u,-126)));
}
/** The node of rank \`rank\` in the file, as far as its own box needs it: the first of its 80 bytes' five
 *  \`vec4u\` (the corner and the exponents with the mask); the links, the metas and the boxes' bytes
 *  (\`stNodeOpen\`) are left zero. */
fn stNodeHead(rank:u32)->StNode{
 let head=stNodes[rank*ST_NODE_VECS];
 let corner=bitcast<vec3f>(head.xyz);
 let scale=stScale(head.w);
 return StNode(corner,scale,(abs(corner)+scale*255.0)*2.4e-7,head.w>>24u,0u,0u,vec2u(0u),vec4u(0u),vec4u(0u),vec4u(0u));
}
/** The node \`nd\` of rank \`rank\` with the other four \`vec4u\` of its bytes (the links and the metas, the
 *  three groups of the boxes' bytes), laid in 16 bytes: what its children need. */
fn stNodeOpen(nd:StNode,rank:u32)->StNode{
 let at=rank*ST_NODE_VECS;
 let links=stNodes[at+1u];
 return StNode(nd.corner,nd.scale,nd.slack,nd.internal,links.x,links.y,links.zw,stNodes[at+2u],stNodes[at+3u],stNodes[at+4u]);
}
/** The grid the node's children are quantised on, its corner to 255 quanta, grown by the slack: a
 *  box that holds every child's. */
fn stNodeBox(nd:StNode)->Box{
 return Box(nd.corner-nd.slack,nd.corner+nd.scale*255.0+nd.slack);
}
/** Child \`slot\` of the node \`nd\` of an instance: its box, the quantised corners on the node's grid, grown by
 *  the slack; the rank in the file of the node it is — the record's first, the node's link and the internal children
 *  before its slot —, or of the first triangle it holds and how many it holds; none for an empty slot. */
fn stChild(nd:StNode,slot:u32,inst:StInstance)->WideChild{
 let shift=(slot&3u)*8u;
 let upper=slot>=4u;
 let code=(select(nd.metas.x,nd.metas.y,upper)>>shift)&255u;
 let low=vec3f(f32((select(nd.grid0.x,nd.grid0.y,upper)>>shift)&255u),f32((select(nd.grid0.z,nd.grid0.w,upper)>>shift)&255u),f32((select(nd.grid1.x,nd.grid1.y,upper)>>shift)&255u));
 let high=vec3f(f32((select(nd.grid1.z,nd.grid1.w,upper)>>shift)&255u),f32((select(nd.grid2.x,nd.grid2.y,upper)>>shift)&255u),f32((select(nd.grid2.z,nd.grid2.w,upper)>>shift)&255u));
 let bit=1u<<slot;
 let inner=(nd.internal&bit)!=0u;
 let node=inst.firstNode+nd.childBase+countOneBits(nd.internal&(bit-1u));
 let triangle=inst.firstTriangle+nd.triangleBase+(code&ST_LEAF_OFFSET_MASK);
 return WideChild(
  Box(nd.corner+nd.scale*low-nd.slack,nd.corner+nd.scale*high+nd.slack),
  select(triangle,node,inner),
  select(code>>ST_LEAF_COUNT_SHIFT,0u,inner),
  inner||code!=0u);
}
/** The three floats from word \`at\` of the table. */
fn stVec3(at:u32)->vec3f{return bitcast<vec3f>(vec3u(stTable[at],stTable[at+1u],stTable[at+2u]));}`

/** One triangle of the file against the ray, in the instance's space. */
const ST_TRIANGLE = `/** The nearer of \`best\` and the triangle \`ti\` of the file against the ray in the instance's space: kept when nearer
 *  than the best hit, past the ray's \`tMin\` and not a front face the ray culls; its normal is the winding's, in the
 *  placement's space. */
fn stTriangle(inst:StInstance,origin:vec3f,direction:vec3f,ti:u32,best:StHit)->StHit{
 // Three \`vec4u\`: the nine floats of the corners, then the cluster, the rank and a zero word.
 let at=ti*ST_TRIANGLE_VECS;
 let v0=stTriangles[at];
 let v1=stTriangles[at+1u];
 let v2=stTriangles[at+2u];
 let a=bitcast<vec3f>(v0.xyz);
 let b=bitcast<vec3f>(vec3u(v0.w,v1.x,v1.y));
 let c=bitcast<vec3f>(vec3u(v1.z,v1.w,v2.x));
 let t=rayTriangleDistance(origin,direction,a,b,c,best.distance);
 if(t>=best.distance||!stStep()){return best;}
 let normal=faceNormal(a,b,c);
 // Counter-clockwise from the ray's origin: the winding against the ray, turned over by a mirroring world.
 let front=(dot(normal,direction)<0.0)!=inst.mirrored;
 if((stRay.flags&ST_CULL_FRONT)!=0u&&front&&!inst.twoSided){return best;}
 if((stRay.flags&ST_CULL_BACK)!=0u&&!front&&!inst.twoSided){return best;}
 if(t<stRay.tMin){return best;}
 // A two-sided primitive's hit under its distance, a one-sided primitive's back face under its own: passed by.
 if((stRay.flags&ST_SKIP_NEAR)!=0u&&select(!front&&t<stParams.skipBackFaceDistance,t<stParams.skipTwoSidedDistance,inst.twoSided)){return best;}
 if((stRay.flags&ST_ANY_HIT)!=0u){stDone=true;}
 return StHit(t,inst.placement,inst.record,ti,normal,front,inst.twoSided,true);
}`

/** The walk of one primitive's structure, the engine's wide traversal. */
const ST_BLAS = wideTraversal({
  name: 'stBlas',
  params: ',inst:StInstance',
  returns: 'StHit',
  start: 'var best=StHit(limit,NO_INDEX,NO_INDEX,NO_INDEX,vec3f(0.0),false,false,false);',
  empty: '',
  root: 'inst.firstNode',
  steps: 'inst.nodes',
  box: 'stNodeBox(nd)',
  child: 'stChild(nd,slot,inst)',
  children: 'ST_WIDTH',
  leaf: 'ST_LEAF_TRIANGLES',
  stack: BLAS_STACK,
  load: 'var nd=stNodeHead(node);',
  open: 'nd=stNodeOpen(nd,node);',
  visit: '',
  stop: 'if(stDone){break;}',
  test: 'best=stTriangle(inst,origin,direction,index,best);',
  overflow: 'stComplete=false;',
  answer: 'best',
})

/** One placement entered, culled as an instance, then taken into its primitive's space. */
const ST_ENTER = `/** The nearer of \`best\` and what the ray meets of placement \`w\`, \`inverse\` the inverse of the ray's direction:
 *  entered, culled as an instance, then taken into its primitive's space. */
fn stEnter(w:u32,best:StHit,inverse:vec3f)->StHit{
 if(stDone||w>=stParams.placements){return best;}
 let record=stTable[stParams.placementWord+w];
 if(record==NO_INDEX){return best;}
 let at=record*ST_RECORD_WORDS;
 let nodes=stTable[at+ST_RECORD_NODES];
 if(nodes==0u){return best;}
 let flags=stTable[at+ST_RECORD_FLAGS];
 if((stRay.flags&ST_SKIP_TRANSLUCENT)!=0u&&(flags&ST_TRANSLUCENT)!=0u){return best;}
 let entry=placementEnter(w,stParams.eyeXY,stParams.eyeZ,stRay.origin,stRay.direction);
 if(!entry.found||((stRay.flags&ST_SHADOW)!=0u&&(entry.mark&ST_CASTS_NO_SHADOW)!=0u)){return best;}
 // The world box of the root, grown by the deformation's reach as the tree's leaf is: none past every finite one.
 if(!reachUnbounded(entry.mark)){
  let reach=vec3f(entry.reach);
  let low=nodesLow(entry.root)-reach;
  let high=nodesHigh(entry.root)+reach;
  let centre=(entry.world*vec4f((low+high)*0.5,1.0)).xyz;
  let extent=transformHalfExtent(entry.world,(high-low)*0.5);
  let outside=max(max(centre-extent,-centre-extent),vec3f(0.0));
  let gap=dot(outside,outside);
  if(gap>stParams.cullRadius*stParams.cullRadius){return best;}
  // The eye inside the box culls none by angle; elsewhere, r² / d² under tan² is r² under tan² d².
  if(gap>0.0&&dot(extent,extent)<stParams.tanCullAngle2*dot(centre,centre)){return best;}
  if(rayBoxEntry(centre-extent,centre+extent,stRay.origin,inverse,best.distance)>best.distance){return best;}
 }
 if(rayBoxEntry(stVec3(at+ST_RECORD_BOX_MIN),stVec3(at+ST_RECORD_BOX_MAX),entry.origin,rayInverseDirection(entry.direction),best.distance)>best.distance){return best;}
 let inst=StInstance(w,record,stTable[at+ST_RECORD_FIRST_NODE],nodes,stTable[at+ST_RECORD_FIRST_TRIANGLE],entry.mirrored,(flags&ST_TWO_SIDED)!=0u);
 let hit=stBlas(entry.origin,entry.direction,best.distance,inst);
 if(hit.hit&&hit.distance<best.distance){return hit;}
 return best;
}`

/** The trace itself: the placement tree's walk, then the normal of the nearest hit turned into the world. */
const ST_TRACE = `/** The trace of \`ray\`: see the library's comment. */
fn stTrace(ray:StRay)->StHit{
 stRay=ray;
 stDone=false;
 stComplete=true;
 stSteps=0u;
 var best=StHit(ray.tMax,NO_INDEX,NO_INDEX,NO_INDEX,vec3f(0.0),false,false,false);
${placementTreeCast({
  eyeXY: 'stParams.eyeXY',
  eyeZ: 'stParams.eyeZ',
  offset: 'ray.origin',
  direction: 'ray.direction',
  placements: 'stParams.placements',
  root: 'stParams.treeRoot',
  table: 'tree',
  enter: 'best=stEnter(w,best,inverse);',
  stop: 'if(stDone){done=true;break;}',
  visit: '',
  steps: `${TREE_STEPS}u`,
  cut: 'stComplete=false;',
})}
 if(best.hit&&(ray.flags&ST_ANY_HIT)==0u){
  // The triangle's normal in the world, the inverse transpose of the placement's linear part turning it,
  // facing the ray whichever side was met: the side the winding faced is \`frontFace\`.
  let turned=unitOrZero(inverseTranspose3(worldsLinear(best.placement),best.normal));
  best.normal=select(-turned,turned,dot(turned,ray.direction)<0.0);
 }
 return best;
}`

/**
 * THE SCENE TRACE: one ray against the compiled primitives' acceleration structures
 * (`rayTracing.bin`, `rayTracingFile.ts`), placed as the cut places them — the nearest triangle it
 * meets, or, for a shadow ray (`ST_ANY_HIT`), the first. `stTrace(ray)` answers an `StHit`.
 *
 * A ray is in the eye's frame: its origin is relative to the eye `params.eye` (three doubles), its
 * direction a unit vector, `tMin` and `tMax` lengths along it in metres. A hit is the placement it
 * met (its rank in the cut's tables), its record, its triangle (the rank in the file's triangles,
 * which names its cluster beside its corners), the distance, the geometric normal in the world
 * facing the ray's side, whether the triangle's winding faced the ray (`frontFace`, as the world
 * turns it: a mirrored world flips it), and whether its primitive is two-sided. Whether the trace
 * is complete is `stComplete`, read once `stTrace` has returned: false when a bound ended it before
 * the tree was walked whole, so that a nearer triangle may have been left untested — a step count
 * spent, a stack full.
 *
 * A ray's `flags` choose what it meets: `ST_ANY_HIT` ends the trace at the first hit (a shadow ray's);
 * `ST_CULL_FRONT` ignores a triangle whose winding faces the ray, `ST_CULL_BACK` one whose winding faces
 * away, unless its primitive is two-sided (`frontFace` as the world turns it); `ST_SHADOW` ignores the
 * placements whose mark says they cast no shadow; `ST_SKIP_TRANSLUCENT` the primitives flagged
 * translucent; `ST_SKIP_NEAR` passes by, past the ray's `tMin`, a hit on a two-sided primitive nearer than
 * `params.skipTwoSidedDistance` and a back face of a one-sided one nearer than `params.skipBackFaceDistance`
 * (the ray goes on to the next hit, as a retrace from past it would find). An any-hit ray answers `hit`
 * alone: its normal is not turned into the world.
 *
 * Level 1 is the cast of the ray through the placement tree (`placementTreeCast`, as the ray query
 * casts its own), front to back; a packing too small for a tree enters its placements in turn.
 * Each placement is entered as the ray query enters its own (`placementEnter`), then culled as an
 * instance: left out when its world box lies past `cullRadius` of the eye, or when its half
 * diagonal subtends less than the culling angle seen from it; one the ray's line misses, or without
 * a record, costs nothing more.
 *
 * Level 2 walks the primitive's structure, in the placement's space (a parameter along the ray
 * there is the world distance), by the engine's one wide traversal (`wideTraversal`), nearest child
 * first: a node is its 80 bytes loaded once, the box of a child decoded from the node's corner and
 * exponents and met by the slab test, the node's own box the grid its children are quantised on.
 * Every triangle the ray meets nearer than the best hit is a step of `params.maxIterations`, before
 * the ray's `tMin` and its culling and skipping flags judge it: the bound spent, the trace stops with the hit it holds and is
 * incomplete. The walks themselves are bounded by their structures alone: the tree's boxes
 * (`TREE_STEPS`) and the record's nodes, each visited once. A full stack of the structure's walk
 * leaves the child out and marks the trace incomplete.
 */
export const sceneTraceWgsl = (group: number, first: number) =>
  wgslBlock(
    `SCENE_TRACE_WGSL(${group},${first})`,
    [
      sceneTraceBindings(group, first),
      DAG_READ_TABLES_WGSL,
      worldAtEyeWgsl('worlds'),
      PLACEMENT_ENTER_WGSL,
      PLACEMENT_TREE_WALK_WGSL,
      WIDE_TRAVERSAL_WGSL,
      inverseTranspose3,
      unitOrZero,
      transformHalfExtent,
      faceNormal,
      rayBoxEntry,
      rayInverseDirection,
      rayTriangleDistance,
      reachUnboundedWgsl,
      pow2FromExponent,
      NO_INDEX,
    ],
    [ST_TYPES, ST_NODE_READS, ST_TRIANGLE, ST_BLAS, ST_ENTER, ST_TRACE].join('\n'),
  )
