import { FLOAT32_MAX, NO_INDEX } from '../../../../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import {
  MOBILITY_DEFORMS,
  MOBILITY_FAR_SHADOW,
  MOBILITY_FAR_SKIPPED,
  MOBILITY_FAR_TESTED,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_OFFSET_KEEPS_CACHE,
  MOBILITY_WORLD_SPACE,
  MOBILITY_HIDDEN_SHADOW,
  MOBILITY_OFFSET_SILENT,
  MOBILITY_SHADOWLESS,
} from '../../mobilityBits.ts'
import { WPO_ROW_ALWAYS } from '../../../../visibility/types.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../../../visibility/shader/pageWgsl.ts'
import { FAR_TESTED_WGSL } from '../../../../visibility/shader/castingMark.ts'
import {
  FLAG_BACK,
  FLAG_DOUBLE,
  FLAG_DYNAMIC,
  FLAG_LINE,
  FLAG_SPRITE,
  FLAG_VOXEL,
} from '../../../../visibility/types.ts'
import { unitOrZero } from '../../../../../../math/src/wgsl/inverseTranspose.ts'
import { matrixWindingCw } from '../../../../../../math/src/wgsl/matrix.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../../math/src/wgsl/number.ts'
import { bitIsSet, bitWord, ceilDivWgsl } from '../../../../../../math/src/wgsl/integer.ts'
import { dAdd, dSub, splitDouble } from '../../../../../../math/src/wgsl/double.ts'
import { fromF32, toF32 } from '../../../../../../math/src/wgsl/f32.ts'
import { recordTextureWgsl } from '../../../../gpu/core/recordTextureWgsl.ts'
import { COLD_TABLE, CLUSTER_TABLE, FLAG_TABLE } from '../../../../geometry/dag/cut/cutTables.ts'
import {
  CLUSTER_LAYOUT,
  COLD_HAS_BOX,
  COLD_MAX,
  COLD_MIN,
  COLD_WORDS,
} from '../../../../geometry/dag/layout.ts'
import { CLUSTER_NEVER, CLUSTER_TRANSPARENT } from '../../../../geometry/dag/clusterFlags.ts'
import { CLUSTER_INFO } from '../../../../geometry/dag/info/clusterInfoLayout.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_INSTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_NEAR_WORD,
  INFO_SHIFT_WORD,
  RECORD_SHIFT_WORD,
  frameTableWgsl,
} from '../../../../geometry/dag/frameTable.ts'
import { OUTSIDE_DRAW_DISTANCES_WGSL } from '../../../../geometry/dag/shader/drawDistanceWgsl.ts'
import { worldGateWgsl } from '../../../../geometry/dag/shader/worldGateWgsl.ts'
import { DAG_MARK_OF_WGSL } from '../../../../geometry/dag/shader/levelWgsl.ts'
import { worldAtEyeWgsl } from '../../../../geometry/dag/shader/worldPoseWgsl.ts'
import { worldTableWgsl } from '../../../../geometry/dag/worlds/worldTable.ts'
import { VISIBLE_LAYOUT_WGSL } from '../../../../geometry/dag/visible/layout.ts'
import { markReachWgsl } from '../../../../deformation/halfFloat.ts'
import { ROOT_BOX_DOUBLES } from '../../../../placement/roots/rootWorldSends.ts'
import { TESSELLATED_FLAGS_WGSL } from '../../../../visibility/tessellation/rowWgsl.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'
import { VSM_OVERFLOW_WGSL } from '../overflowWgsl.ts'
import { UNBOUNDED_EXTENT } from '../invalidationWgsl.ts'

/** THE SHADOW RASTER'S CASTER CANDIDATES (`renderCullWgsl.ts`): one thread a page the shadow
 *  views' descent listed (`../traversal/traversalWgsl.ts`) — an instance, a (placement, page)
 *  pair —, every resident cluster that may cast appended with its
 *  sphere, its flags and the bounds and errors each map judges its level of detail by, whatever the
 *  frustum and the pyramid of the main view say of it: each map view selects its own cut
 *  (`vsmRenderLodAt`). */

/** The group of a candidates kernel that binds the cut's tables (`VSM_RENDER_WORLD_WGSL`). */
export const VSM_RENDER_WORLD_GROUP = 1

/** Group 1's bindings: the cut's cold words, its frame words, the words of the main view's filter,
 *  its clusters' hot records, its placements' worlds and the poses the previous image drew them at
 *  (`../../../../geometry/dag/previousPoses.ts`), and the shadow views' descent's flags, which hold
 *  the pages it listed (`../traversal/traversalWgsl.ts`). */
const VSM_RENDER_WORLD_BINDING = {
  cold: 0,
  frames: 1,
  filter: 2,
  clusters: 3,
  worlds: 4,
  previous: 5,
  listed: 6,
} as const
const B = VSM_RENDER_WORLD_BINDING

/** The sphere and the box of a cluster's box in the world, and the rounding they cover: the radius
 *  is the farthest corner of the box carried by the placement's world, in single precision, grown
 *  past every rounding, with the growth and the margin of the CPU's sphere of a cluster
 *  (`../../../../placement/rows/rowSphere.ts`). This kernel's sphere is its own: its centre is a
 *  single-precision product beside the exact translation, `CENTRE_ERROR` of the products'
 *  magnitudes added for it, where the CPU's centre is a double (its change box,
 *  `../../casters/clusterSphere.ts`, is the only reader of that formula). The box takes the same
 *  growth and margin (`casterSphere`). */
const SPHERE_GROWTH = 1 + 2 ** -21
const SPHERE_MARGIN = 2 ** -20
const CENTRE_ERROR = 2 ** -21

/** The world sphere and the world box of a box of a placement (\`casterSphere\`): the casters'
 *  (\`vsmRenderCaster\`) and the shadow views' descent's (\`../traversal/traversalWgsl.ts\`), over the
 *  worlds table its program binds as \`worlds\`. */
export const VSM_CASTER_SPHERE_WGSL = wgslBlock(
  'VSM_CASTER_SPHERE_WGSL',
  [dAdd, fromF32, splitDouble, unitOrZero],
  `const SPHERE_GROWTH:f32=${wgslF32(SPHERE_GROWTH)};
const SPHERE_MARGIN:f32=${wgslF32(SPHERE_MARGIN)};
const CENTRE_ERROR:f32=${wgslF32(CENTRE_ERROR)};
/** A reach that bounds nothing (infinite, or not a number) as large as f32 clip math keeps
 *  (\`UNBOUNDED_EXTENT\`): the casters' and the descent's boxes of a placement are the same finite
 *  ones. */
fn casterReach(reach:f32)->f32{return select(${wgslF32(UNBOUNDED_EXTENT)},reach,reach<${wgslF32(UNBOUNDED_EXTENT)});}
/** The world sphere and the world box of a cluster of box \`lo\`..\`hi\` under the world \`w\` places it
 *  by: the centre a single-precision product of the linear part beside the exact translation, split
 *  into a high and a low single, the radius the farthest corner, grown past every rounding. Centre
 *  then radius in \`high\`, the centre's low part in \`low\`; the box about that centre in \`axes\`, its
 *  three half axes.
 *
 *  A half axis is a column of the linear part times the local half extent (the reach included): a
 *  single-precision product a component, off by 2^-24 of itself at most, so grown by
 *  \`SPHERE_GROWTH\` (2^-21, eight times that) and, along its own direction (the column's, whatever
 *  the extent), by the margin the radius carries (\`margin\`: the products' magnitudes and the centre's
 *  rounding). Its three axes, each grown along itself, hold the ball of that margin about the centre
 *  where the columns are orthogonal (a rotation and a scale on each axis); a placement with a shear
 *  has the constants' slack over the roundings (8 and 16) to cover what the skew takes. */
fn casterSphere(w:u32,lo:vec3f,hi:vec3f,reach:f32,high:ptr<function,vec4f>,low:ptr<function,vec3f>,axes:ptr<function,array<vec3f,3>>){
 let centre=(lo+hi)*0.5;
 let extent=(hi-lo)*0.5+vec3f(casterReach(reach));
 let l=worldsLinear(w);
 let lc=l*centre;
 let o0=worldsOrigin(w,0u);let o1=worldsOrigin(w,1u);
 var origin=array<vec2u,3>(o0.xy,o0.zw,o1.xy);
 var hiPart=vec3f(0.0);var loPart=vec3f(0.0);
 for(var a=0u;a<3u;a++){
  let split=splitDouble(dAdd(fromF32(bitcast<u32>(lc[a])),origin[a]));
  hiPart[a]=bitcast<f32>(split.x);
  loPart[a]=bitcast<f32>(split.y);
 }
 var m:array<f32,9>;
 var size=0.0;var sums=0.0;
 for(var i=0u;i<3u;i++){
  var l1=0.0;
  for(var j=0u;j<3u;j++){
   let value=l[j][i];
   m[i*3u+j]=value*extent[j];
   size+=abs(value)*abs(centre[j]);
   l1+=abs(m[i*3u+j]);
  }
  sums+=l1*l1;
 }
 var r2=0.0;
 for(var k=0u;k<4u;k++){
  let a=select(-1.0,1.0,(k&1u)==0u);
  let b=select(-1.0,1.0,(k&2u)==0u);
  var norm=0.0;
  for(var i=0u;i<3u;i++){
   let x=m[i*3u]+a*m[i*3u+1u]+b*m[i*3u+2u];
   norm+=x*x;
  }
  r2=max(r2,norm);
 }
 let margin=sqrt(sums)*SPHERE_MARGIN+size*CENTRE_ERROR;
 *high=vec4f(hiPart,sqrt(r2)*SPHERE_GROWTH+margin);
 *low=loPart;
 for(var j=0u;j<3u;j++){
  (*axes)[j]=vec3f(m[j],m[3u+j],m[6u+j])*SPHERE_GROWTH+unitOrZero(l[j])*margin;
 }
}
`,
)

/** How far the centre of a box moved since the previous image drew the placement (`vsmRenderPrevShift`),
 *  over the placements' previous poses its program binds as `previous`: the casters' (`vsmRenderCaster`)
 *  and the shadow views' descent's (`../traversal/traversalWgsl.ts`). */
export const VSM_PREV_SHIFT_WGSL = wgslBlock(
  'VSM_PREV_SHIFT_WGSL',
  [dAdd, dSub, fromF32, toF32],
  `/** How far the centre of a cluster of box centre \`centre\` moved since the previous image drew
 *  placement \`w\` (its previous local-to-world): the previous pose's
 *  linear part on the centre beside its exact translation, less the sphere's centre (\`high\`,
 *  \`low\`), in double, rounded once — zero for a placement that stood still. */
fn vsmRenderPrevShift(w:u32,centre:vec3f,high:vec3f,low:vec3f)->vec3f{
 let lc=previousLinear(w)*centre;
 let o0=previousOrigin(w,0u);let o1=previousOrigin(w,1u);
 var origin=array<vec2u,3>(o0.xy,o0.zw,o1.xy);
 var shift=vec3f(0.0);
 for(var a=0u;a<3u;a++){
  let before=dAdd(fromF32(bitcast<u32>(lc[a])),origin[a]);
  let now=dAdd(fromF32(bitcast<u32>(high[a])),fromF32(bitcast<u32>(low[a])));
  shift[a]=bitcast<f32>(toF32(dSub(before,now)));
 }
 return shift;
}
`,
)

/**
 * The cut's tables, as its descent reads them (`worldGateWgsl`, `DAG_RECORD_WGSL`): its cold words
 * at 0 and its frame words at 1 of `VSM_RENDER_WORLD_GROUP`, under the cut's names; the words of the
 * cut's `work` the main view's filter lies in at 2 (`filterBits`, `VsmRenderParams.filterBase`: a
 * stand-in word for a view that filters none); the clusters' hot records at 3, the placements'
 * worlds at 4 and their previous poses at 5, the worlds' layout (`worldTableWgsl`); the shadow views'
 * descent's flags at 6, its listed pages from `VsmRenderParams.listedBase`. The cold word
 * its placements' links start at is in the parameters (`VsmRenderParams.worldLinks`), zero for a
 * cut that follows no world.
 */
const VSM_RENDER_WORLD_WGSL = wgslBlock(
  'VSM_RENDER_WORLD_WGSL',
  [
    recordTextureWgsl(COLD_TABLE, {
      name: 'cold',
      group: VSM_RENDER_WORLD_GROUP,
      binding: B.cold,
      access: 'read',
    }),
    frameTableWgsl('frames', { group: VSM_RENDER_WORLD_GROUP, binding: B.frames, access: 'read' }),
    recordTextureWgsl(CLUSTER_TABLE, {
      name: 'clusters',
      group: VSM_RENDER_WORLD_GROUP,
      binding: B.clusters,
      access: 'read',
    }),
    worldTableWgsl('worlds', { group: VSM_RENDER_WORLD_GROUP, binding: B.worlds, access: 'read' }),
    worldTableWgsl('previous', {
      group: VSM_RENDER_WORLD_GROUP,
      binding: B.previous,
      access: 'read',
    }),
    recordTextureWgsl(FLAG_TABLE, {
      name: 'listed',
      group: VSM_RENDER_WORLD_GROUP,
      binding: B.listed,
      access: 'read',
    }),
    worldAtEyeWgsl('worlds'),
    worldGateWgsl('params.worldLinks'),
  ],
  `@group(${VSM_RENDER_WORLD_GROUP}) @binding(${B.filter}) var<storage,read> filterBits:array<u32>;
/** Whether the main view does not draw placement \`w\` (\`Camera.hidden\`, \`Camera.showOnly\`): its bit
 *  in the view's filter, the one the camera's cut tests its roots by (\`filteredOut\`). A shadow is of
 *  what the view draws: a hidden object casts none. None when the parameters name no filter. */
fn vsmRenderFilteredOut(w:u32)->bool{
 let at=params.filterBase+(w>>5u);
 if(params.filterBase==0u||at>=arrayLength(&filterBits)){return false;}
 return (filterBits[at]&(1u<<(w&31u)))!=0u;
}`,
)

/**
 * What a candidates kernel reads — group 0: 0 params (uniform, dynamic), 1 the clusters' records, 2
 * the placements' words, 3 the placements' world boxes, 4 the list of casters it writes, 5 the
 * candidates (rw), 6 the counters (rw atomic), 7 the clusters' edges; group 1 the cut's tables (`VSM_RENDER_WORLD_WGSL`).
 */
const VSM_RENDER_CASTERS_WGSL = wgslBlock(
  'VSM_RENDER_CASTERS_WGSL',
  [
    PAGE_INFO_STRUCT_WGSL,
    VSM_RENDER_PARAMS_WGSL,
    VISIBLE_LAYOUT_WGSL,
    FLOAT32_MAX,
    matrixWindingCw,
    VSM_RENDER_WORLD_WGSL,
    OUTSIDE_DRAW_DISTANCES_WGSL,
    TESSELLATED_FLAGS_WGSL,
    FAR_TESTED_WGSL,
    DAG_MARK_OF_WGSL,
    markReachWgsl,
    ceilDivWgsl,
    bitWord,
    bitIsSet,
    NO_INDEX,
    dAdd,
    dSub,
    fromF32,
    toF32,
    splitDouble,
    VSM_CASTER_SPHERE_WGSL,
    VSM_PREV_SHIFT_WGSL,
  ],
  `
${CLUSTER_INFO.wgsl}
${CLUSTER_LAYOUT.wgsl}
@group(0) @binding(0) var<uniform> params:VsmRenderParams;
@group(0) @binding(1) var<storage,read> info:array<ClusterInfo>;
@group(0) @binding(2) var<storage,read> rootWords:array<u32>;
@group(0) @binding(3) var<storage,read> rootBoxes:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> casters:array<u32>;
@group(0) @binding(5) var<storage,read_write> candidates:array<VsmRenderCandidate>;
@group(0) @binding(6) var<storage,read_write> counts:array<atomic<u32>>;
/** Each cluster record's longest edge (\`GpuSelection.edges\`, the cut's measure): what picks a
 *  cluster's raster in each map's view (\`vsmRenderSoftware\`). */
@group(0) @binding(7) var<storage,read> edges:array<f32>;
${wgslConsts({ CASTER_COLD: COLD_WORDS, ROOT_BOX_DOUBLES, CLUSTER_NEVER, CLUSTER_TRANSPARENT, WPO_ROW_ALWAYS })}
/** The words of the cut's residency bit sets: the cut rule's \`resident(c)\` first, then that of the
 *  finer group (\`../../../../geometry/dag/layout.ts\`). */
fn casterResidentWords()->u32{return ceilDiv(params.pageCount,32u);}
fn casterResident(i:u32)->bool{return bitIsSet(coldAt(bitWord(i)),i);}
fn casterChildResident(i:u32)->bool{return bitIsSet(coldAt(casterResidentWords()+bitWord(i)),i);}
/** Cold word \`k\` of record \`r\`, read as a float: its box, whether it has one. */
fn casterCold(r:u32,k:u32)->f32{return bitcast<f32>(coldAt(2u*casterResidentWords()+r*CASTER_COLD+k));}
fn casterBoxMin(r:u32)->vec3f{return vec3f(casterCold(r,${COLD_MIN}u),casterCold(r,${COLD_MIN + 1}u),casterCold(r,${COLD_MIN + 2}u));}
fn casterBoxMax(r:u32)->vec3f{return vec3f(casterCold(r,${COLD_MAX}u),casterCold(r,${COLD_MAX + 1}u),casterCold(r,${COLD_MAX + 2}u));}
/** The hot record \`r\`: the cluster's sphere and its parent's, both errors and the flags. */
fn casterHot(r:u32)->Cluster{
 let a=clustersCluster(r,0u);let b=clustersCluster(r,1u);let c=clustersCluster(r,2u);
 return Cluster(bitcast<vec4f>(a),bitcast<vec4f>(b),bitcast<f32>(c.x),bitcast<f32>(c.y),c.z);
}
/** A caster's candidate flags, from its placement's word: cached as dynamic while its placement
 *  moves or deforms, and deforming — its pages invalidated as it draws them — while it deforms. */
fn vsmRenderCandidateFlags(word:u32)->u32{
 let deforms=(word&${MOBILITY_DEFORMS}u)!=0u;
 let dynamic=(word&${MOBILITY_MOVING}u)!=0u||deforms;
 return select(0u,VSM_RENDER_CAND_DYNAMIC,dynamic)|select(0u,VSM_RENDER_CAND_DEFORMING,deforms);
}
/** A caster's far-shadow flags, for the suns' test (\`vsmFarShadowSkipped\`): tested as its object
 *  says (\`MOBILITY_FAR_TESTED\`, \`MOBILITY_FAR_SKIPPED\` of its placement's \`word\`:
 *  \`farShadowTest\`), else when the parameters say every mesh is (\`farMeshes\`) or the placement
 *  belongs to the world's merged shells (\`worldPlaced\`), and casting far when its object does
 *  (\`MOBILITY_FAR_SHADOW\`). The objects drawn as themselves, saying nothing, keep casting at any
 *  distance unless the parameters ask for every mesh. */
fn vsmRenderFarFlags(word:u32,placement:u32)->u32{
 let tested=farTestedOf((word&${MOBILITY_FAR_TESTED}u)!=0u||worldPlaced(placement),(word&${MOBILITY_FAR_SKIPPED}u)!=0u,params.farMeshes!=0u);
 return select(0u,VSM_RENDER_CAND_FAR_TESTED,tested)|select(0u,VSM_RENDER_CAND_FAR_CAST,(word&${MOBILITY_FAR_SHADOW}u)!=0u);
}
/** The ball of the whole object a cluster of placement \`w\` belongs to, from the main view's eye
 *  (centre, then radius): the placement's world box, the instance's bounds, grown by its reach; the
 *  cluster's own ball (\`own\`) for a placement of the world DAG — its merged shells have no bounds
 *  of their own on the GPU — or one with no box. The object is what a sun's far-shadow test judges
 *  whole, all or nothing for every cluster of it. */
fn vsmRenderObject(w:u32,own:vec4f,reach:f32)->vec4f{
 if(worldPlaced(w)){return own;}
 let o=w*ROOT_BOX_DOUBLES;
 if(o+ROOT_BOX_DOUBLES>arrayLength(&rootBoxes)){return own;}
 var nonZero=false;
 for(var k=0u;k<6u;k++){nonZero=nonZero||rootBoxes[o+k].x!=0u||rootBoxes[o+k].y!=0u;}
 if(!nonZero){return own;}
 let ex=vec2u(params.eye0.x,params.eye0.y);let ey=vec2u(params.eye0.z,params.eye0.w);let ez=vec2u(params.eye1.x,params.eye1.y);
 let lo=vec3f(bitcast<f32>(toF32(dSub(rootBoxes[o],ex))),bitcast<f32>(toF32(dSub(rootBoxes[o+1u],ey))),bitcast<f32>(toF32(dSub(rootBoxes[o+2u],ez))));
 let hi=vec3f(bitcast<f32>(toF32(dSub(rootBoxes[o+3u],ex))),bitcast<f32>(toF32(dSub(rootBoxes[o+4u],ey))),bitcast<f32>(toF32(dSub(rootBoxes[o+5u],ez))));
 if(!(all(hi>=lo)&&all(abs(lo)<vec3f(FLOAT32_MAX))&&all(abs(hi)<vec3f(FLOAT32_MAX)))){return own;}
 return vec4f((lo+hi)*0.5,length(hi-lo)*0.5+reach);
}
/** The ball of the instance placement \`w\` is, from the main view's eye (centre, then radius): its
 *  local bounds' centre carried by its world and the half extent of those bounds scaled along each
 *  axis of the world (the roots pass's ball, \`composeRoot\`); \`other\` for a placement of the world
 *  DAG or one with no local bounds. What a map judges whether the instance stays out of the coarse
 *  pages by, once for all its clusters. */
fn vsmRenderInstance(w:u32,other:vec4f)->vec4f{
 if(worldPlaced(w)){return other;}
 let o=w*ROOT_BOX_DOUBLES;
 if(o+ROOT_BOX_DOUBLES>arrayLength(&rootBoxes)){return other;}
 let radius=rootBoxes[o+10u];
 if(radius.x==0u&&radius.y==0u){return other;}
 let ex=vec2u(params.eye0.x,params.eye0.y);let ey=vec2u(params.eye0.z,params.eye0.w);let ez=vec2u(params.eye1.x,params.eye1.y);
 return vec4f(bitcast<f32>(toF32(dSub(rootBoxes[o+7u],ex))),bitcast<f32>(toF32(dSub(rootBoxes[o+8u],ey))),bitcast<f32>(toF32(dSub(rootBoxes[o+9u],ez))),bitcast<f32>(toF32(radius)));
}
/** The depth of the object along the main view, its radius taken off: what a sun's far-shadow test
 *  compares to its distance, all or nothing for every cluster of the object. */
fn vsmRenderFarDepth(object:vec4f)->f32{return -dot(params.viewRow2.xyz,object.xyz)-object.w;}
/** Whether the object of placement \`w\`, \`delta\` from the main view's eye, is out of the draw
 *  distances it names — its mark's bit, then its two frame words — and casts nothing: a shadow is
 *  of what the view draws, from the main view's eye in every pass of the light, tested at the
 *  object's centre. None when the parameters say no caster takes them (\`drawDistances\`: bit 0 for an
 *  object of its own, bit 1 for an instance, which the host's switch turns off). */
fn vsmRenderOutsideDrawDistance(w:u32,delta:vec3f)->bool{
 let mark=markOf(w);
 if(params.drawDistances==0u||(mark&${DRAW_DISTANCE_MARK}u)==0u){return false;}
 if((params.drawDistances&select(1u,2u,(mark&${DRAW_INSTANCE_MARK}u)!=0u))==0u){return false;}
 return outsideDrawDistances(length(delta),0.0,bitcast<f32>(framesWord(w,${DRAW_NEAR_WORD}u)),bitcast<f32>(framesWord(w,${DRAW_FAR_WORD}u)),params.viewDistanceScale);
}
/** The longest edge of cluster record \`n\` in world units, its placement's greatest axis scale
 *  \`stretch\` on it: zero for none measured yet or for a line, which the hardware raster alone
 *  widens (the camera's \`FORCE_HARDWARE\`). */
fn vsmRenderEdge(n:u32,flags:u32,stretch:f32)->f32{
 if(n>=arrayLength(&edges)||(flags&${FLAG_LINE}u)!=0u){return 0.0;}
 return edges[n]*stretch;
}
/** The caster of packed page \`i\` of placement \`w\`, a resident page the shadow views' descent
 *  listed (\`../traversal/traversalWgsl.ts\`), if it may cast — whatever level
 *  of detail a map takes of it, which each map judges (\`vsmRenderLodAt\`) —, the world's switch,
 *  the main view's filter and the draw distances, and the candidate appended with its sphere, the
 *  half axes of its box, its corners, its flags, and its group's and its parent's bounds and errors
 *  in world units, their centres from the sphere's (the placement's linear part on their local
 *  offsets from the box's centre: exact beside the split translation). */
fn vsmRenderCaster(i:u32,w:u32){
 var word=0u;var viewBits=0u;var disableSq=0.0;
 let rootCount=arrayLength(&rootWords)/3u;
 if(w<rootCount){word=rootWords[w];viewBits=rootWords[rootCount+w];disableSq=bitcast<f32>(rootWords[2u*rootCount+w]);}
 if((word&${MOBILITY_SHADOWLESS}u)!=0u){return;}
 let r=i+framesWord(w,${RECORD_SHIFT_WORD}u);
 let cluster=casterHot(r);
 if((cluster.flags&(CLUSTER_NEVER|CLUSTER_TRANSPARENT))!=0u){return;}
 let n=i+framesWord(w,${INFO_SHIFT_WORD}u);
 if(n>=arrayLength(&info)){return;}
 let record=info[n];
 if(record.indexCount==0u||(record.flags&${FLAG_SPRITE}u)!=0u){return;}
 // An object that stands for a first-person one, or casts while hidden, is hidden by the view's filter and
 // casts all the same.
 if(!worldDraws(i,w)||(vsmRenderFilteredOut(w)&&(word&${MOBILITY_WORLD_SPACE | MOBILITY_HIDDEN_SHADOW}u)==0u)){return;}
 let reach=casterReach(markReach(markOf(w)));
 var lo=casterBoxMin(r);var hi=casterBoxMax(r);
 if(casterCold(r,${COLD_HAS_BOX}u)==0.0){
  lo=cluster.sphere.xyz-vec3f(cluster.sphere.w);
  hi=cluster.sphere.xyz+vec3f(cluster.sphere.w);
 }
 var high:vec4f;var low:vec3f;var axes:array<vec3f,3>;
 casterSphere(w,lo,hi,reach,&high,&low,&axes);
 if(!(high.w>=0.0&&high.w<FLOAT32_MAX)){return;}
 let pose=worldsWorldAtEye(w,params.eye0,params.eye1);
 let stretch=bitcast<f32>(framesStretchBits(w));
 let own=cluster.sphere;
 let ownRel=(pose*vec4f(own.xyz,1.0)).xyz;
 let object=vsmRenderObject(w,vec4f(ownRel,own.w*stretch+reach),reach);
 if(vsmRenderOutsideDrawDistance(w,object.xyz)){return;}
 let flipped=matrixWindingCw(pose)!=((record.flags&${FLAG_BACK}u)!=0u);
 var page:PageInfo;
 page.flags=record.flags;
 let tessellated=params.tessellated!=0u&&tessellatedFlags(page);
 // Vertices that move — a dynamic geometry, a deformation, an offset — are judged for their raster at
 // the sphere around the box grown by their reach, as the camera's cut judges them (\`rasteredInHardware\`).
 let moving=(record.flags&${FLAG_DYNAMIC}u)!=0u||reach>0.0||record.wpo!=0u;
 let extra=select(0u,VSM_RENDER_CAND_TESSELLATED,tessellated)|select(0u,VSM_RENDER_CAND_CHILD_RESIDENT,casterChildResident(i))|select(0u,VSM_RENDER_CAND_MOVING,moving);
 // A surface that wears an offset: its placement evaluates it, or the surface does whatever the placement says.
 let wears=record.wpo!=0u;
 let offsetAlways=wears&&(record.wpo&WPO_ROW_ALWAYS)!=0u;
 let offsetEvaluated=wears&&((word&${MOBILITY_OFFSET_SILENT}u)==0u||offsetAlways);
 // The placement's own offset facts, which decide the layer of all its clusters alike.
 let placementOffset=(word&${MOBILITY_OFFSET_INVALIDATES}u)!=0u;
 let offsetFlags=select(0u,VSM_RENDER_CAND_OFFSET,offsetEvaluated)|select(0u,VSM_RENDER_CAND_OFFSET_ALWAYS,offsetAlways)
  |select(0u,VSM_RENDER_CAND_PLACEMENT_OFFSET,placementOffset)
  |select(0u,VSM_RENDER_CAND_PLACEMENT_ALWAYS,(word&${MOBILITY_OFFSET_ALWAYS}u)!=0u)
  |select(0u,VSM_RENDER_CAND_OFFSET_KEEPS,(word&${MOBILITY_OFFSET_KEEPS_CACHE}u)!=0u)
  |select(0u,VSM_RENDER_CAND_WORLD_SPACE,(word&${MOBILITY_WORLD_SPACE}u)!=0u);
 let flags=vsmRenderCandidateFlags(word)|select(0u,VSM_RENDER_CAND_FLIPPED,flipped)|vsmRenderFarFlags(word,w)|extra|offsetFlags;
 // Out of every map view's far-shadow distance: no view takes it, no cull need read it.
 let farDepth=vsmRenderFarDepth(object);
 if(vsmFarShadowSkipped(flags,farDepth,params.farDrop)){return;}
 let corners=select(record.indexCount,2u*record.indexCount,(record.flags&${FLAG_DOUBLE}u)!=0u)|select(0u,VSM_RENDER_VOXEL_BIT,(record.flags&${FLAG_VOXEL}u)!=0u);
 let slot=atomicAdd(&counts[0],1u);
 // Past the room the candidate is counted and not written (\`vsmRenderCastersDone\` holds the count to it).
 if(slot>=params.casterCap){return;}
 let l=worldsLinear(w);
 let centre=(lo+hi)*0.5;
 // The instance's ball from the cluster's centre: what each map judges the instance by whole, the same for every cluster of it.
 let ball=vsmRenderInstance(w,object);
 let inst=vec4f(ball.xyz-(pose*vec4f(centre,1.0)).xyz,ball.w);
 let lod=vec4f(l*(own.xyz-centre),own.w*stretch);
 let parent=vec4f(l*(cluster.parentSphere.xyz-centre),cluster.parentSphere.w*stretch);
 let errors=vec2f(cluster.lodError,cluster.parentError)*stretch;
 candidates[slot]=VsmRenderCandidate(high,low,slot,axes[0],corners,axes[1],flags,axes[2],farDepth,vsmRenderPrevShift(w,centre,high.xyz,low),vsmRenderEdge(n,record.flags,stretch),lod,parent,inst,errors,select(0.0,disableSq,offsetEvaluated||placementOffset),viewBits);
 let at=VISIBLE_HEADER_WORDS+VISIBLE_RECORD_WORDS*slot;
 casters[at]=i;
 casters[at+1u]=w;
 casters[at+2u]=0u;
}`,
)

/** The casters' kernel: a thread a page the descent listed (`VSM_RENDER_CASTERS_WGSL`). */
export const VSM_RENDER_CASTERS_ENTRY = 'vsmRenderCandidates'
/** The casters of the frame (`VSM_RENDER_CASTERS_WGSL`): one thread a page the descent listed, from
 *  the first it listed in the running pass (`VSM_RENDER_COUNT_LISTED_FIRST`, none in the main
 *  pass) up to its end. */
export const vsmRenderCandidatesWgsl = () =>
  wgslProgram(
    `
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_RENDER_CASTERS_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let k=atomicLoad(&counts[VSM_RENDER_COUNT_LISTED_FIRST])+flatIndex(id,n,WORKGROUP_THREADS);
 if(k>=atomicLoad(&counts[VSM_RENDER_COUNT_LISTED])){return;}
 let at=params.listedBase+2u*k;
 vsmRenderCaster(listedWord(at,0u).x,listedWord(at+1u,0u).x);
}
`,
    [VSM_RENDER_CASTERS_WGSL, FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL],
  )

/** The kernel that closes the list of casters: one thread, the count held to the room — what was
 *  found, the list's header made as the decode reads
 *  it (`VISIBLE_HEADER_WORDS`). */
export const VSM_RENDER_CASTERS_DONE_ENTRY = 'vsmRenderCandidatesDone'
/** The same, for the casters the descent's post pass listed: behind those it listed first, which
 *  the list's split keeps apart (`VIS_SW_SPLIT`) for the decode of the post pass. */
export const VSM_RENDER_CASTERS_POST_DONE_ENTRY = 'vsmRenderCandidatesPostDone'

/** The casters' closing kernels (`VSM_RENDER_CASTERS_DONE_ENTRY`, `_POST_DONE_ENTRY`), over a group
 *  0 of their own: 0 params (uniform, dynamic), 1 the list of casters, 2 the counters (rw atomic), 3
 *  the stats, where a count found past the room sets the visible instances' overflow flag
 *  (`VSM_OVERFLOW_VISIBLE_INSTANCES`). */
export const vsmRenderCastersDoneWgsl = () =>
  wgslProgram(
    `
@group(0) @binding(0) var<uniform> params:VsmRenderParams;
@group(0) @binding(1) var<storage,read_write> casters:array<u32>;
@group(0) @binding(2) var<storage,read_write> counts:array<atomic<u32>>;
@group(0) @binding(3) var<storage,read_write> vsmStats:array<atomic<u32>>;
/** The count of casters held to the room. */
fn vsmRenderCastersHeld()->u32{
 let found=atomicLoad(&counts[0]);
 if(found>params.casterCap){atomicOr(&vsmStats[VSM_OVERFLOW_FLAGS],VSM_OVERFLOW_VISIBLE_INSTANCES);}
 let total=min(found,params.casterCap);
 atomicStore(&counts[0],total);
 return total;
}
@compute @workgroup_size(1) fn ${VSM_RENDER_CASTERS_DONE_ENTRY}(){
 casters[VIS_SW]=vsmRenderCastersHeld();
 casters[VIS_HW]=0u;
 casters[VIS_SW_SPLIT]=NO_SPLIT;
 casters[VIS_HW_SPLIT]=NO_SPLIT;
}
@compute @workgroup_size(1) fn ${VSM_RENDER_CASTERS_POST_DONE_ENTRY}(){
 let total=vsmRenderCastersHeld();
 casters[VIS_SW]=total;
 casters[VIS_HW]=0u;
 casters[VIS_SW_SPLIT]=min(atomicLoad(&counts[VSM_RENDER_COUNT_CAST_FIRST]),total);
 casters[VIS_HW_SPLIT]=NO_SPLIT;
}
`,
    [VSM_RENDER_PARAMS_WGSL, VISIBLE_LAYOUT_WGSL, VSM_OVERFLOW_WGSL],
  )
