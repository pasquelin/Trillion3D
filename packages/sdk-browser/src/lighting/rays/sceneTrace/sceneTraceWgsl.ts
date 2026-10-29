import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { NO_INDEX } from '../../../../../math/src/wgsl/constants.ts'
import {
  faceNormal,
  rayBoxEntry,
  rayInverseDirection,
  rayTriangleBarycentric,
  rayTriangleDistance,
  transformHalfExtent,
} from '../../../../../math/src/wgsl/geometry.ts'
import { pow2FromExponent } from '../../../../../math/src/wgsl/integer.ts'
import { inverseTranspose3, unitOrZero } from '../../../../../math/src/wgsl/inverseTranspose.ts'
import {
  RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  RAY_TRACING_FLAG_TRANSLUCENT,
  RAY_TRACING_FLAG_TWO_SIDED,
  RAY_TRACING_LEAF_COUNT_SHIFT,
  RAY_TRACING_LEAF_OFFSET_MASK,
  RAY_TRACING_LEAF_TRIANGLES,
  RAY_TRACING_NODE_BYTES,
  RAY_TRACING_MIN_EXPONENT,
  RAY_TRACING_RECORD_AT,
  RAY_TRACING_STACK,
  RAY_TRACING_TRIANGLE_AT,
  RAY_TRACING_TRIANGLE_BYTES,
  RAY_TRACING_WIDTH,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import { RAY_TRACING_RECORD_WORDS } from '../../../../../sdk-core/src/lighting/rayTracingFile.ts'
import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { computeBufferEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { reachUnboundedWgsl } from '../../../deformation/halfFloat.ts'
import { CASTS_NO_SHADOW } from '../../../visibility/shader/spriteWgsl.ts'
import { WORLD_SPACE_ROOT } from '../../../visibility/shader/castingMark.ts'
import { DAG_READ_TABLES_WGSL } from '../../../geometry/dag/shader/bindings.ts'
import { worldAtEyeWgsl } from '../../../geometry/dag/shader/worldPoseWgsl.ts'
import {
  PLACEMENT_TREE_WALK_WGSL,
  placementTreeCast,
  TREE_STEPS,
} from '../../../geometry/dag/tree/treeWalkWgsl.ts'
import { PLACEMENT_ENTER_WGSL } from '../rayPlacementWgsl.ts'
import {
  TRACED_MATERIAL_AT,
  TRACED_MATERIAL_FLAGS,
  TRACED_MATERIAL_WORDS,
} from '../../reflections/translucency/materialWords.ts'
import type { SceneTrace } from './sceneTraceResources.ts'
import { WIDE_TRAVERSAL_WGSL, wideTraversal } from '../wideTraversalWgsl.ts'

/** The nodes a structure's walk keeps for later, the stack its walk is given: as many as the compiler lets a walk of any tree
 *  of the file need (`RAY_TRACING_STACK`, `stack_need`), so that the walk of a tree is never cut short by it. */
const BLAS_STACK = RAY_TRACING_STACK

/** The bit of a placement's word in the table (`sceneTraceResources.ts`) that says it is a placement of the world DAG: the
 *  word then holds its instance in the bits under, and its structure is the world's directory. */
export const SCENE_TRACE_WORLD_BIT = 0x80000000

/** A cell's word in the table (`sceneTraceResources.ts`): the bit that says the cut draws the cell's actor, and under it
 *  (`SCENE_TRACE_CELL_OBJECT_MASK`) the object a hit on the actor is told to a hit table by (`StHit.object`), plus one: zero for an
 *  actor with none, which a hit then names `NO_INDEX`, as a miss does. */
export const SCENE_TRACE_CELL_DRAWN = 0x80000000
const SCENE_TRACE_CELL_OBJECT_MASK = 0x7fffffff

/**
 * The scene trace's parameters, one uniform (`sceneTraceResources.ts` writes it): the eye the
 * rays and the placements are taken to — three doubles, as a ray of the ray query holds its origin —,
 * the culling radius in metres (where the screen's far trace of a reflection begins; the largest number
 * while no culling is on), the squared tangent of the culling angle, the bound on the steps of a trace,
 * the placement tree's top (none without a tree), the
 * placements the packing holds, where in the table buffer the table from a placement to its
 * record begins, the world's directory (none without HLOD actors in the file), where the words
 * of the HLOD cells (`SCENE_TRACE_CELL_DRAWN`) begin, how many an instance of the world DAG
 * holds, the two distances, in metres, under which a ray that asks it (`ST_SKIP_NEAR`)
 * passes a hit by: a back face of a one-sided primitive, any hit on a two-sided one, and the
 * culling of the placements (`sceneCullWgsl.ts`, which writes the words of the table at `cullWord`, one for
 * each placement, nonzero for one left out of the image): its mode, its switches (`SCENE_CULL_FLAGS`), the
 * direction the view looks along and the scale of the instances' draw distances, and whether the translucent primitives of a mesh that has
 * an opaque one are left out of the rays that ask it (`ST_SKIP_TRANSLUCENT`; `skipsTranslucentSections`, one by default), and where in the table the
 * placements' material words begin (`materialWord`, `TRACED_MATERIAL_WORDS` a placement, which the traced translucency reads a hit's material from).
 */
export const SCENE_TRACE_PARAMS = fieldLayout('StParams', [
  ['eyeXY', 'vec4u'],
  ['eyeZ', 'vec2u'],
  ['cullRadius', 'f32'],
  ['culledTanAngleSq', 'f32'],
  ['maxIterations', 'u32'],
  ['treeRoot', 'u32'],
  ['placements', 'u32'],
  ['placementWord', 'u32'],
  ['worldRecord', 'u32'],
  ['cellsWord', 'u32'],
  ['cells', 'u32'],
  ['skipBackFaceDistance', 'f32'],
  ['skipTwoSidedDistance', 'f32'],
  ['cullWord', 'u32'],
  ['cullMode', 'u32'],
  ['cullFlags', 'u32'],
  ['viewDirection', 'vec3f'],
  ['viewDistanceScale', 'f32'],
  ['skipsTranslucentSections', 'u32'],
  ['materialWord', 'u32'],
] as const)

/** The parameters' uniform `stParams` at binding `binding` of group `group`: what the trace and the culling pass share. */
export const sceneTraceParamsWgsl = (group: number, binding: number) =>
  wgslBlock(
    `sceneTraceParams(${group},${binding})`,
    [],
    `${SCENE_TRACE_PARAMS.wgsl}
@group(${group}) @binding(${binding}) var<uniform> stParams:StParams;
/** The eye's z words as the world at the eye takes its second operand (\`worldAtEyeWgsl\`): the x and y words are \`stParams.eyeXY\`. */
fn stEyeZ()->vec4u{return vec4u(stParams.eyeZ,0u,0u);}`,
  )

/**
 * The scene trace's declarations in group `group` from binding `first` (`sceneTraceLayoutEntries`
 * is their layout): `stParams`, `stNodes` (five `vec4u` a node), `stTriangles` (three `vec4u` a triangle), `stTable`. The placement tree and the
 * placements' worlds are not here: they are the cut's record tables, listed beside
 * (`DAG_READ_TABLES_WGSL`, group 0 at the culling's bindings).
 */
const sceneTraceBindings = (group: number, first: number) =>
  wgslBlock(
    `sceneTraceBindings(${group},${first})`,
    [sceneTraceParamsWgsl(group, first)],
    `@group(${group}) @binding(${first + 1}) var<storage,read> stNodes:array<vec4u>;
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
 *  rule (the placements that cast none), the translucent primitives left out, the near hits passed by, the stand-ins of
 *  first-person objects met. */
const SCENE_TRACE_FLAGS = {
  anyHit: 1,
  cullFront: 2,
  shadow: 4,
  cullBack: 8,
  skipTranslucent: 16,
  skipNear: 32,
  meetWorldSpace: 64,
  barycentric: 128,
  meetTranslucent: 256,
  onlyTranslucent: 512,
} as const

const R = RAY_TRACING_RECORD_AT
/** A triangle's last vector: its words from the cluster's on, where a directory's entry names its actor and its cell. */
const TAIL = RAY_TRACING_TRIANGLE_AT.cluster & ~3

/** The words and masks the library reads, as the file lays them: a node and a triangle are read as `vec4u`. */
const SCENE_TRACE_CONSTS = wgslConsts({
  ST_NODE_VECS: RAY_TRACING_NODE_BYTES / 16,
  ST_TRIANGLE_VECS: RAY_TRACING_TRIANGLE_BYTES / 16,
  ST_TAIL_VEC: TAIL / 4,
  ST_TAIL_ACTOR: RAY_TRACING_TRIANGLE_AT.cluster - TAIL,
  ST_TAIL_CELL: RAY_TRACING_TRIANGLE_AT.tag - TAIL,
  ST_RECORD_WORDS: RAY_TRACING_RECORD_WORDS,
  ST_RECORD_FLAGS: R.flags,
  ST_RECORD_FIRST_NODE: R.firstNode,
  ST_RECORD_NODES: R.nodeCount,
  ST_RECORD_FIRST_TRIANGLE: R.firstTriangle,
  ST_RECORD_BOX_MIN: R.boxMin,
  ST_RECORD_BOX_MAX: R.boxMax,
  ST_RECORD_TRIANGLES: R.triangleCount,
  ST_WORLD_BIT: SCENE_TRACE_WORLD_BIT,
  ST_CELL_DRAWN: SCENE_TRACE_CELL_DRAWN,
  ST_OBJECT_MASK: SCENE_TRACE_CELL_OBJECT_MASK,
  ST_WIDTH: RAY_TRACING_WIDTH,
  ST_LEAF_TRIANGLES: RAY_TRACING_LEAF_TRIANGLES,
  ST_LEAF_COUNT_SHIFT: RAY_TRACING_LEAF_COUNT_SHIFT,
  ST_LEAF_OFFSET_MASK: RAY_TRACING_LEAF_OFFSET_MASK,
  ST_TWO_SIDED: RAY_TRACING_FLAG_TWO_SIDED,
  ST_TRANSLUCENT: RAY_TRACING_FLAG_TRANSLUCENT,
  ST_ALL_TRANSLUCENT: RAY_TRACING_FLAG_ALL_TRANSLUCENT,
  ST_CASTS_NO_SHADOW: CASTS_NO_SHADOW,
  ST_ANY_HIT: SCENE_TRACE_FLAGS.anyHit,
  ST_CULL_FRONT: SCENE_TRACE_FLAGS.cullFront,
  ST_SHADOW: SCENE_TRACE_FLAGS.shadow,
  ST_CULL_BACK: SCENE_TRACE_FLAGS.cullBack,
  ST_SKIP_TRANSLUCENT: SCENE_TRACE_FLAGS.skipTranslucent,
  ST_SKIP_NEAR: SCENE_TRACE_FLAGS.skipNear,
  ST_MEET_WORLD_SPACE: SCENE_TRACE_FLAGS.meetWorldSpace,
  ST_BARYCENTRIC: SCENE_TRACE_FLAGS.barycentric,
  ST_MEET_TRANSLUCENT: SCENE_TRACE_FLAGS.meetTranslucent,
  ST_ONLY_TRANSLUCENT: SCENE_TRACE_FLAGS.onlyTranslucent,
  ST_MATERIAL_WORDS: TRACED_MATERIAL_WORDS,
  ST_MATERIAL_FLAGS_AT: TRACED_MATERIAL_AT.flags,
  ST_MATERIAL_TRANSLUCENT: TRACED_MATERIAL_FLAGS.translucent,
  ST_WORLD_SPACE_ROOT: WORLD_SPACE_ROOT,
})
/** The least exponent a node's scale takes, the compiler's (`RAY_TRACING_MIN_EXPONENT`). */
const SCENE_TRACE_SIGNED_CONSTS = wgslConsts({ ST_MIN_EXPONENT: RAY_TRACING_MIN_EXPONENT }, 'i32')

/** The constants, the structures and the state of the trace in progress. */
const ST_TYPES = `${SCENE_TRACE_CONSTS}
${SCENE_TRACE_SIGNED_CONSTS}
struct StRay{origin:vec3f,direction:vec3f,tMin:f32,tMax:f32,flags:u32,}
/** A hit: its distance, the placement it met, its record, its triangle in the file and the object a hit table names its surface by (the
 *  placement, for a placement's; for an HLOD actor's, the object the cut's cell word gives; \`NO_INDEX\` for a miss and for an actor with
 *  none), the normal, the faces, and, for a ray that asks it (ST_BARYCENTRIC), the weights of the triangle's second and third corners at the hit. */
struct StHit{distance:f32,placement:u32,record:u32,triangle:u32,object:u32,normal:vec3f,bary:vec2f,frontFace:bool,twoSided:bool,hit:bool,}
/** A node of a primitive's structure: its corner, the size of a quantum along each axis, how far a
 *  rounded box may fall short of the exact one, the children that are nodes, the links, the eight
 *  metas and the children's boxes' bytes, as the file lays them. */
struct StNode{corner:vec3f,scale:vec3f,slack:vec3f,internal:u32,childBase:u32,triangleBase:u32,metas:vec2u,grid0:vec4u,grid1:vec4u,grid2:vec4u,}
/** A placement taken into its primitive's space: its rank, its record, the first node, the nodes and
 *  the first triangle of the record, whether the world mirrors, whether the primitive is two-sided, the object its hits
 *  are told by, and, for the world's directory, the word of the table where the cells of its instance begin (\`NO_INDEX\`
 *  for any other). */
struct StInstance{placement:u32,record:u32,firstNode:u32,nodes:u32,firstTriangle:u32,mirrored:bool,twoSided:bool,object:u32,cells:u32,}
/** The trace in progress: its ray, whether it is done (a hit of an any-hit ray), whether it is
 *  complete — the answer to read once \`stTrace\` has returned —, and the steps spent. */
var<private> stRay:StRay;
var<private> stDone:bool;
var<private> stComplete:bool;
var<private> stSteps:u32;
/** Whether the trace in progress leaves out the primitive of the record flags \`flags\`: its mesh is translucent whole (\`ST_ALL_TRANSLUCENT\`),
 *  whatever the image asks, unless the ray meets translucent geometry (ST_MEET_TRANSLUCENT); or it is translucent, the ray asks it (ST_SKIP_TRANSLUCENT) and the image tests the mesh sections' visibility. */
fn stSkipsTranslucent(flags:u32)->bool{
 return ((flags&ST_ALL_TRANSLUCENT)!=0u&&(stRay.flags&ST_MEET_TRANSLUCENT)==0u)||((stRay.flags&ST_SKIP_TRANSLUCENT)!=0u&&stParams.skipsTranslucentSections!=0u&&(flags&ST_TRANSLUCENT)!=0u);
}`

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
  pow2FromExponent(max(bitcast<i32>(word<<24u)>>24u,ST_MIN_EXPONENT)),
  pow2FromExponent(max(bitcast<i32>(word<<16u)>>24u,ST_MIN_EXPONENT)),
  pow2FromExponent(max(bitcast<i32>(word<<8u)>>24u,ST_MIN_EXPONENT)));
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
 return StHit(t,inst.placement,inst.record,ti,inst.object,normal,vec2f(0.0),front,inst.twoSided,true);
}
/** The weights of the second and third corners of the triangle ti at which the ray in the instance's space meets it: asked once of a placement's winning hit, not of each nearer candidate. */
fn stBarycentric(origin:vec3f,direction:vec3f,ti:u32)->vec2f{
 let at=ti*ST_TRIANGLE_VECS;
 let v0=stTriangles[at];
 let v1=stTriangles[at+1u];
 let v2=stTriangles[at+2u];
 let a=bitcast<vec3f>(v0.xyz);
 return rayTriangleBarycentric(origin,direction,a,bitcast<vec3f>(vec3u(v0.w,v1.x,v1.y)),bitcast<vec3f>(vec3u(v1.z,v1.w,v2.x)));
}`

/** The wide traversal of one instance's nodes, `test` the line run on each leaf entry: the nearest hit under `limit`, ended at once by an any-hit ray. */
function stInstanceWalk(name: string, test: string) {
  return wideTraversal({
    name,
    params: ',inst:StInstance',
    returns: 'StHit',
    start:
      'var best=StHit(limit,NO_INDEX,NO_INDEX,NO_INDEX,NO_INDEX,vec3f(0.0),vec2f(0.0),false,false,false);',
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
    test,
    overflow: 'stComplete=false;',
    answer: 'best',
  })
}

/** The walk of one primitive's structure, the engine's wide traversal. */
const ST_BLAS = stInstanceWalk('stBlas', 'best=stTriangle(inst,origin,direction,index,best);')

/** The actor of an entry of the world's directory, entered as a placement is: the entry (a box where a triangle's corners are,
 *  then the actor's rank among the actors' records, a zero word and its HLOD cell) read, the cell's word asked whether the cut
 *  draws the actor, and, if it does, the actor's record entered and its structure walked. */
const ST_ACTOR = `/** The nearer of \`best\` and what the ray meets of the actor of the entry \`ti\` of the directory \`dir\`: none if the cut
 *  does not draw its cell, else its structure walked in the space of the directory's placement, whose box the walk met. */
fn stActor(dir:StInstance,origin:vec3f,direction:vec3f,ti:u32,best:StHit)->StHit{
 let tail=stTriangles[ti*ST_TRIANGLE_VECS+ST_TAIL_VEC];
 let cell=stTable[dir.cells+tail[ST_TAIL_CELL]];
 if((cell&ST_CELL_DRAWN)==0u){return best;}
 // The actors' records are the ones just before the directory's, in the actors' order: the entries lie in leaf order and name their actor by rank.
 let record=dir.record-stTable[dir.record*ST_RECORD_WORDS+ST_RECORD_TRIANGLES]+tail[ST_TAIL_ACTOR];
 let at=record*ST_RECORD_WORDS;
 let nodes=stTable[at+ST_RECORD_NODES];
 let flags=stTable[at+ST_RECORD_FLAGS];
 if(nodes==0u||stSkipsTranslucent(flags)){return best;}
 let inst=StInstance(dir.placement,record,stTable[at+ST_RECORD_FIRST_NODE],nodes,stTable[at+ST_RECORD_FIRST_TRIANGLE],dir.mirrored,(flags&ST_TWO_SIDED)!=0u,(cell&ST_OBJECT_MASK)-1u,NO_INDEX);
 let hit=stBlas(origin,direction,best.distance,inst);
 if(hit.hit&&hit.distance<best.distance){return hit;}
 return best;
}`

/** The walk of the world's directory, the same traversal over a tree of actors' boxes. */
const ST_DIRECTORY = stInstanceWalk(
  'stDirectory',
  'best=stActor(inst,origin,direction,index,best);',
)

/** One placement entered unless this image's culling left it out, then taken into its primitive's space. */
const ST_ENTER = `/** The nearer of \`best\` and what the ray meets of placement \`w\`, \`inverse\` the inverse of the ray's direction:
 *  none of a placement the image's culling left out (\`sceneCullWgsl.ts\`), else entered and taken into its primitive's
 *  space. A placement of the world DAG is entered as the world's directory, which enters the actors the cut draws (\`stActor\`). */
fn stEnter(w:u32,best:StHit,inverse:vec3f)->StHit{
 if(stDone||w>=stParams.placements||stTable[stParams.cullWord+w]!=0u){return best;}
 let slot=stTable[stParams.placementWord+w];
 if(slot==NO_INDEX){return best;}
 let world=(slot&ST_WORLD_BIT)!=0u;
 let record=select(slot,stParams.worldRecord,world);
 if(record==NO_INDEX){return best;}
 let at=record*ST_RECORD_WORDS;
 let nodes=stTable[at+ST_RECORD_NODES];
 if(nodes==0u){return best;}
 let flags=stTable[at+ST_RECORD_FLAGS];
 if(stSkipsTranslucent(flags)){return best;}
 // A ray that meets only the translucent surfaces passes the placements whose material is not.
 if((stRay.flags&ST_ONLY_TRANSLUCENT)!=0u&&(stTable[stParams.materialWord+w*ST_MATERIAL_WORDS+ST_MATERIAL_FLAGS_AT]&ST_MATERIAL_TRANSLUCENT)==0u){return best;}
 let entry=placementEnter(w,stParams.eyeXY,stParams.eyeZ,stRay.origin,stRay.direction);
 if(!entry.found||((stRay.flags&ST_SHADOW)!=0u&&(entry.mark&ST_CASTS_NO_SHADOW)!=0u)||((stRay.flags&ST_MEET_WORLD_SPACE)==0u&&(entry.mark&ST_WORLD_SPACE_ROOT)!=0u)){return best;}
 // The world box of the root, grown by the deformation's reach as the tree's leaf is: none past every finite one.
 if(!reachUnbounded(entry.mark)){
  let reach=vec3f(entry.reach);
  let low=nodesLow(entry.root)-reach;
  let high=nodesHigh(entry.root)+reach;
  let centre=(entry.world*vec4f((low+high)*0.5,1.0)).xyz;
  let extent=transformHalfExtent(entry.world,(high-low)*0.5);
  if(rayBoxEntry(centre-extent,centre+extent,stRay.origin,inverse,best.distance)>best.distance){return best;}
 }
 if(rayBoxEntry(stVec3(at+ST_RECORD_BOX_MIN),stVec3(at+ST_RECORD_BOX_MAX),entry.origin,rayInverseDirection(entry.direction),best.distance)>best.distance){return best;}
 let cells=select(NO_INDEX,stParams.cellsWord+(slot&~ST_WORLD_BIT)*stParams.cells,world);
 let inst=StInstance(w,record,stTable[at+ST_RECORD_FIRST_NODE],nodes,stTable[at+ST_RECORD_FIRST_TRIANGLE],entry.mirrored,(flags&ST_TWO_SIDED)!=0u,w,cells);
 var hit:StHit;
 if(world){hit=stDirectory(entry.origin,entry.direction,best.distance,inst);}
 else{hit=stBlas(entry.origin,entry.direction,best.distance,inst);}
 if(hit.hit&&hit.distance<best.distance){
  if((stRay.flags&ST_BARYCENTRIC)!=0u){hit.bary=stBarycentric(entry.origin,entry.direction,hit.triangle);}
  return hit;
 }
 return best;
}`

/** The trace itself: the placement tree's walk, then the normal of the nearest hit turned into the world. */
const ST_TRACE = `/** The trace of \`ray\`: see the library's comment. */
fn stTrace(ray:StRay)->StHit{
 stRay=ray;
 stDone=false;
 stComplete=true;
 stSteps=0u;
 var best=StHit(ray.tMax,NO_INDEX,NO_INDEX,NO_INDEX,NO_INDEX,vec3f(0.0),vec2f(0.0),false,false,false);
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
 * translucent, where the image tests the mesh sections' visibility (`params.skipsTranslucentSections`; else they are met as opaque ones,
 * but for those of a mesh all of whose primitives are translucent, `ST_ALL_TRANSLUCENT`, which only a ray that sets `ST_MEET_TRANSLUCENT` meets, as a path tracer's); `ST_SKIP_NEAR` passes by, past the ray's `tMin`, a hit on a two-sided primitive nearer than
 * `params.skipTwoSidedDistance` and a back face of a one-sided one nearer than `params.skipBackFaceDistance`
 * (the ray goes on to the next hit, as a retrace from past it would find); a ray that does not set `ST_MEET_WORLD_SPACE` passes by the placements whose mark says they stand, in the world, for
 * a first-person object (`WORLD_SPACE_ROOT`): only the rays that ask meet them, and a ray cast from a first-person pixel does not, for it would meet the other copy of its own mesh. An any-hit ray answers `hit`
 * alone: its normal is not turned into the world. `ST_BARYCENTRIC` adds to a hit the weights of its triangle's second and third corners (`StHit.bary`), the point's coordinates in the triangle.
 *
 * Level 1 is the cast of the ray through the placement tree (`placementTreeCast`, as the ray query
 * casts its own), front to back; a packing too small for a tree enters its placements in turn.
 * Each placement is entered as the ray query enters its own (`placementEnter`), unless the image's culling pass
 * left it out (`sceneCullWgsl.ts`: a word of the table, written once for the image, not tested by each ray); one
 * the ray's line misses, or without a record, costs nothing more.
 *
 * A placement of the world DAG is entered as the file's directory of the world's HLOD actors, a tree over their boxes: each
 * actor is a mesh of its own, as an instance of a scene is, with a structure of its own (its record), and is entered only
 * where the cut draws it this frame. The directory's entries name the actor and its HLOD cell, whose word in the placement's
 * instance (`sceneTraceResources.ts`) says whether the cut draws the actor as its cell's (`CELL_DRAW.hlod`) — never when it
 * draws the cell as its placements, which are roots of their own — and the object a hit on it is told by. A hit names the
 * world's placement, the actor's record and the triangle in the file, whose cluster is the actor's cluster.
 *
 * Level 2 walks the primitive's (or the actor's) structure, in the placement's space (a parameter along the ray
 * there is the world distance), by the engine's one wide traversal (`wideTraversal`), nearest child
 * first: a node is its 80 bytes loaded once, the box of a child decoded from the node's corner and
 * exponents and met by the slab test, the node's own box the grid its children are quantised on.
 * Every triangle the ray meets nearer than the best hit is a step of `params.maxIterations`, before
 * the ray's `tMin` and its culling and skipping flags judge it: the bound spent, the trace stops with the hit it holds and is
 * incomplete. The walks themselves are bounded by their structures alone: the tree's boxes
 * (`TREE_STEPS`) and the record's nodes, each visited once. The stack of a structure's walk holds as many nodes as
 * the compiler lets any walk need (`RAY_TRACING_STACK`, `stack_need`: at a node the walk keeps the hit internal
 * children but the nearest, so the need is the sum along a path of the internal children less one, and no tree is
 * written whose need is more): a full stack is a file of another compiler, and leaves the child out and marks the trace
 * incomplete, never silently.
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
      rayTriangleBarycentric,
      reachUnboundedWgsl,
      pow2FromExponent,
      NO_INDEX,
    ],
    [
      ST_TYPES,
      ST_NODE_READS,
      ST_TRIANGLE,
      ST_BLAS,
      ST_ACTOR,
      ST_DIRECTORY,
      ST_ENTER,
      ST_TRACE,
    ].join('\n'),
  )
