/**
 * THE SHADOW VIEWS' DESCENT: the camera's level-by-level descent of the cut hierarchy
 * (`../../../../geometry/dag/shader/levelWgsl.ts`, its lists, the placement tree's share) run over a
 * list of views, as the reference's persistent hierarchy culling runs over every view of a pass, each
 * candidate node carrying the view that tests it. The kernels are the camera's, written for a views
 * descent (`VSM_DESCENT_SHAPE`, `../../../../geometry/dag/shader/descentShape.ts`); what is the
 * shadow views' own is how a view tests a node.
 *
 * A VIEW is a map of a light and a mip of it that has a page to draw (`vsmDescentViews`: its stale
 * rect is not empty, `vsmRenderMapMips`), as the reference's packed views are one a map and mip. Queue
 * 0 holds every view's roots — a placement's, or the placement tree's top nodes and the members
 * drawn whatever the view — and each level tests an entry's children against its view:
 * - in the view's map (`outsideFrustum`, `vsmDescentInMap`): the box's world sphere
 *   (`casterSphere`, the casters' own), its radius doubled — the sphere of a box within it lies within
 *   it —, against the map's box cull (`vsmBoxInView`), a local light's range first; a cell of the
 *   tree alike (`vsmDescentCellOutside`);
 * - its subtree needed at the view's mip (`vsmDescentNeeded`): the greatest error its clusters
 *   replace (`maxParentError`) over the node's ball, projected by the mip as the cull projects a
 *   cluster's (`vsmRenderViewPixels`), past the shadows' threshold. A projection that only grows as
 *   the ball holds more and the error does, so no node it drops holds a cluster the cull would draw
 *   in that mip (`vsmRenderLodAt` asks its parent's error to show);
 * - not hidden by the pyramid of the view's map (`boxSight`): while the previous frame's pyramid and
 *   tables are kept (`OCCLUSION_TWO_PASS` in the block), the node's sphere doubled, where the
 *   previous image drew it, is tested against that pyramid at the view's mip
 *   (`vsmHiddenBefore`, in both layers of the map): hidden, the node waits for the post pass
 *   (`BOX_OCCLUDED`, `postNode`, with its view) and its subtree is not walked. Once the main pass's
 *   clusters are drawn and the pyramid built over them, the post pass (`dagPostNodes`, `heldHere`
 *   the views of the running view pass) tests the nodes held again against this frame's
 *   (`vsmHiddenNow`): seen, a node enters queue 0 and every level runs again on it; hidden in both
 *   layers, it is gone. A box that hides in the sphere doubled hides every cluster under it, so no
 *   cluster the cull would draw is lost.
 * A kept leaf asks for its pages in each view that keeps it (`depositLeaf`, `requestPage`, the
 * shadow views' priority word, `vsmDescentPriority`, at the category the reference gives them),
 * and lists its resident pages once, whichever views keep it (`candAppend`): the casters' kernel
 * builds them (`../render/renderCandidatesWgsl.ts`; the post pass's, behind the main pass's) and the
 * cull judges each against every map of the view pass, its level of detail its own.
 *
 * What the casters' kernel tests of an object — the main view's filter, its draw distances, its
 * world's switch, a sun's far shadows, an assembly's parent group — is tested there, a cluster at a
 * time: the descent tests none of it (`filteredOut`, `outsideDrawDistance`, … none), and keeps every
 * leaf whatever its floor (`floorPrunes`): it drops no cluster the casters would keep.
 *
 * Group 0: the cut's tables at the culling's bindings (`DAG_BINDINGS_WGSL`): the nodes, the
 * descent's uniform block (`cutView`, the main view's with the descent's caps), its flags, its readout
 * (`out`, the requests), its `work`, the worlds, the frame words, the cold words, the tree, the poses
 * the previous image drew. Group 1: 0 the raster's parameters (uniform, dynamic), 1 the maps'
 * records, 2 the stale rects, 3 the frame's lights, 4 the raster's counters (rw atomic), 5 the VSM
 * uniforms. Group 2: the occlusion's (`VSM_OCCLUSION_TEST_WGSL`), the previous frame's pyramid and
 * tables in the main pass, this frame's in the post pass.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FLOAT32_MAX } from '../../../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../../../math/src/wgsl/number.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { CLUSTER_LAYOUT } from '../../../../geometry/dag/layout.ts'
import { CLUSTER_INFO } from '../../../../geometry/dag/info/clusterInfoLayout.ts'
import { VIEW_UNIFORM_STRUCT } from '../../../../geometry/dag/viewLayout.ts'
import { markReachWgsl } from '../../../../deformation/halfFloat.ts'
import { DAG_ACCESS_WGSL } from '../../../../geometry/dag/shader/bindings.ts'
import { DAG_RECORD_WGSL } from '../../../../geometry/dag/shader/recordWgsl.ts'
import { DAG_WORLD_GATE_WGSL } from '../../../../geometry/dag/shader/worldGateWgsl.ts'
import { DAG_NO_GATES_WGSL } from '../../../../geometry/dag/shader/noGatesWgsl.ts'
import { DAG_READING_WGSL } from '../../../../geometry/dag/shader/snapshotWgsl.ts'
import { DAG_VIEWS_WGSL } from '../../../../geometry/dag/shader/viewsWgsl.ts'
import { DAG_ARM_WGSL } from '../../../../geometry/dag/shader/armWgsl.ts'
import { bitMask, bitWord, ceilDivWgsl } from '../../../../../../math/src/wgsl/integer.ts'
import { BLOCK_MASK_WORDS_WGSL, FRAME_COUNTERS } from '../../../../geometry/dag/shader/floorWgsl.ts'
import { DAG_CUT_PASS_WGSL } from '../../../../geometry/dag/shader/occlusionWgsl.ts'
import { dagPostPassWgsl } from '../../../../geometry/dag/shader/postPassWgsl.ts'
import { dagLevelWgsl } from '../../../../geometry/dag/shader/levelWgsl.ts'
import { dagListsWgsl } from '../../../../geometry/dag/shader/listsWgsl.ts'
import {
  DAG_TREE_PREPARE_WGSL,
  dagTreeDescentWgsl,
} from '../../../../geometry/dag/shader/placementTreeWgsl.ts'
import {
  CULL_NODE_STRUCT,
  DAG_OUTPUT_STRUCT,
  DAG_PRIMITIVE_READS,
} from '../../../../geometry/dag/shader/shader.ts'
import { requestPriorityOf } from '../../../../geometry/dag/shader/error.ts'
import { worldAtEyeWgsl } from '../../../../geometry/dag/shader/worldPoseWgsl.ts'
import type { DescentShape } from '../../../../geometry/dag/shader/descentShape.ts'
import { VSM_BOX_VIEW_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_HANDLE_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_RENDER_PARAMS_WGSL } from '../render/renderParamsWgsl.ts'
import { VSM_RENDER_VIEW_PIXELS_WGSL } from '../render/renderCullWgsl.ts'
import { VSM_CASTER_SPHERE_WGSL, VSM_PREV_SHIFT_WGSL } from '../render/renderCandidatesWgsl.ts'
import { VSM_OCCLUSION_TEST_WGSL } from '../occlusion/occlusionTestWgsl.ts'
import { VSM_RENDER_MAP_VIEW_WGSL } from '../render/renderViewsWgsl.ts'

/** The shadow views' descent (`../../../../geometry/dag/shader/descentShape.ts`). */
export const VSM_DESCENT_SHAPE: DescentShape = {
  views: true,
  subtreeNeeded: 'vsmDescentNeeded(node,w)',
  cameraSubtree: false,
  cellOutside: 'vsmDescentCellOutside',
  priority: 'vsmDescentPriority(node,w)',
  resets: '',
}

/** Group 1's VSM resources (`vsmBindingsWgsl`). */
export const VSM_DESCENT_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'projectionData', binding: 1 },
  { resource: 'staleRects', binding: 2 },
  { resource: 'uniforms', binding: 5 },
]

/** The category of the shadow views' requests, the priority word's top two bits: the reference's
 *  for a virtual shadow map's views, below the camera's (`REQUEST_CATEGORY`). */
const VSM_REQUEST_CATEGORY = 0

/** A box's sphere doubled: the sphere of any box within the box lies within it — its centre in the
 *  box, its radius no greater —, grown past the roundings of the two spheres (`casterSphere`). */
const DESCENT_GROWTH = 2 + 2 ** -16
/** What a node's projection is raised by against its clusters': the roundings of its shifted
 *  centre beside theirs. */
const DESCENT_LOD_SLACK = 1 + 2 ** -10
/** The roundings of a shifted centre, relative to its distance from the map's origin. */
const DESCENT_SHIFT_SLACK = 2 ** -18

/** The kernels' entry points, by role. */
export const VSM_DESCENT_ENTRY = {
  views: 'vsmDescentViews',
  prepare: 'vsmDescentPrepare',
  levels: ['dagLevel0', 'dagLevel1', 'dagLevel2'],
  postPrepare: 'dagPostPrepare',
  postNodes: 'dagPostNodes',
  close: 'vsmDescentClose',
  arm: 'dagArm',
} as const
const descentDeclarationsText = () => /* wgsl */ `${CLUSTER_LAYOUT.wgsl}
${CLUSTER_INFO.wgsl}
${CULL_NODE_STRUCT}
${VIEW_UNIFORM_STRUCT}
${DAG_OUTPUT_STRUCT}
${DAG_PRIMITIVE_READS}
@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(3) var<storage,read> lights:array<vec4u>;
@group(1) @binding(4) var<storage,read_write> counts:array<atomic<u32>>;
const DESCENT_GROWTH:f32=${wgslF32(DESCENT_GROWTH)};
const DESCENT_LOD_SLACK:f32=${wgslF32(DESCENT_LOD_SLACK)};
const DESCENT_SHIFT_SLACK:f32=${wgslF32(DESCENT_SHIFT_SLACK)};
/** The descent's \`work\`: the frame counters first (\`counterBase\`), the camera cut's, at the words
 *  its arming kernel reads whatever the cut; the views' list behind them — its count, then each
 *  view's map and mip (\`descentMap\`, \`descentMip\`), \`params.viewCap\` of them —; then the pages'
 *  mask, a bit a packed page, which lists a page once (\`candAppend\`), a block of
 *  \`BLOCK_MASK_WORDS\` words a workgroup's pages. */
fn counterBase()->u32{return 0u;}
fn viewBase()->u32{return ${FRAME_COUNTERS}u;}
fn blockCount()->u32{return ceilDiv(cutView.clusterCount,WORKGROUP_THREADS);}
fn drawMaskBase()->u32{return viewBase()+1u+params.viewCap;}
fn drawMaskWord(i:u32)->u32{return drawMaskBase()+bitWord(i);}
fn drawBit(i:u32)->u32{return bitMask(i);}
fn descentViews()->u32{return min(atomicLoad(&work[viewBase()]),params.viewCap);}
/** View \`view\`: the map in the low half of its word, its mip in the high half. */
fn descentViewWord(view:u32)->u32{return atomicLoad(&work[viewBase()+1u+view]);}
/** The running entry's map and mip. */
fn descentMap()->u32{return descentViewWord(descentView)&0xFFFFu;}
fn descentMip()->u32{return descentViewWord(descentView)>>16u;}
fn descentMapsEnd(light:vec4u)->u32{return min(light.x+light.y,vsm.mapCount);}
/** Whether view \`view\`, held for the post pass, is a map of the view pass running (\`params.viewFirst\`,
 *  \`params.viewCount\`: the ids of its maps), whose pyramid the pass has just built. */
fn heldHere(view:u32)->bool{
 let map=descentViewWord(view)&0xFFFFu;
 return map>=params.viewFirst&&map<params.viewFirst+params.viewCount;
}
/** The sphere of shifted world centre \`high\` + \`low\` and radius \`high.w\`, doubled, in map space
 *  \`pd\`'s: its centre and half extent as the cull takes a cluster's (\`vsmRenderCullView\`), and its
 *  box cull. */`

const descentViewsText = /* wgsl */ `
struct VsmDescentBox{center:vec3f,extent:vec3f,cull:VsmBoxInView,}
fn vsmDescentBox(pd:VsmProjectionData,high:vec4f,low:vec3f)->VsmDescentBox{
 var box:VsmDescentBox;
 box.center=(high.xyz+pd.originShiftHigh)+(low+pd.originShiftLow);
 box.extent=vec3f(high.w*DESCENT_GROWTH+DESCENT_SHIFT_SLACK*length(box.center));
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let nearClip=pd.lightKind!=LIGHT_KIND_DIRECTIONAL;
 let shiftedToClip=vsmShiftedToClip(pd.shiftedToMapUv);
 let boxPoint=vsmBoxCullPoint(box.center,box.extent,isOrtho,nearClip);
 box.cull=vsmBoxInView(shiftedToClip*vec4f(boxPoint,1.0),shiftedToClip[0],shiftedToClip[1],shiftedToClip[2],box.extent,viewToClip,isOrtho,nearClip);
 return box;
}
/** Whether map \`id\` holds the sphere of shifted world centre \`high\` + \`low\` and radius \`high.w\`:
 *  a local light's range, then the map's box cull, the cull's own (\`vsmRenderCullCandidate\`,
 *  \`vsmRenderCullView\`), on the sphere doubled. */
fn vsmDescentInMap(id:u32,high:vec4f,low:vec3f)->bool{
 let pd=vsmProjectionOf(vsmHandleFromId(id));
 let box=vsmDescentBox(pd,high,low);
 let reach=pd.lightRange+box.extent.x;
 if(pd.lightKind!=LIGHT_KIND_DIRECTIONAL&&dot(box.center,box.center)>reach*reach){return false;}
 return box.cull.inMapView;
}
/** The pixels map \`id\`'s mip \`mip\` spans of an error \`error\` over the ball of shifted centre
 *  \`centre\` and radius \`radius\` (\`vsmRenderViewPixels\`), raised by the roundings. */
fn vsmDescentPixels(id:u32,mip:u32,centre:vec3f,radius:f32,error:f32)->f32{
 let pd=vsmProjectionOf(vsmHandleFromId(id));
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let perspective=select(1.0,0.0,isOrtho);
 let near=select(viewToClip[3][2]/(1.0-viewToClip[2][2]),0.0,isOrtho);
 let focal=0.5*abs(viewToClip[1][1])*f32(VSM_LEVEL0_TEXELS>>mip);
 let pixels=vsmRenderViewPixels(error,centre,radius+DESCENT_SHIFT_SLACK*length(centre),vsmShiftedToClip(pd.shiftedToMapUv),viewToClip,focal,near,perspective);
 return pixels*DESCENT_LOD_SLACK;
}
/** A node's ball (its \`sphere\`) in the shifted space of map \`id\`, from its box's sphere (\`high\`,
 *  \`low\`): the placement's linear part on its offset from the box's centre, as the casters lay a
 *  cluster's (\`vsmRenderCaster\`). */
fn vsmDescentBall(id:u32,node:CullNode,w:u32,high:vec4f,low:vec3f)->vec3f{
 let pd=vsmProjectionOf(vsmHandleFromId(id));
 let centre=(high.xyz+pd.originShiftHigh)+(low+pd.originShiftLow);
 return centre+worldsLinear(w)*(node.sphere.xyz-(node.minimum+node.maximum)*0.5);
}
/** Whether the running entry's map does not hold the box \`lo\`..\`hi\` of placement \`w\`, grown by its
 *  deformation's reach (\`vsmDescentInMap\`). */`

const descentBallText = () => /* wgsl */ `
fn outsideFrustum(w:u32,lo:vec3f,hi:vec3f)->bool{
 var high:vec4f;var low:vec3f;
 casterSphere(w,lo,hi,deformReach,&high,&low);
 return !vsmDescentInMap(descentMap(),high,low);
}
/** Whether the running entry's view sees the error \`node\`'s subtree replaces past the threshold
 *  (\`vsmDescentReach\`), or none bounds it. */
fn vsmDescentNeeded(node:CullNode,w:u32)->bool{
 if(node.maxParentError<0.0){return true;}
 return vsmDescentReach(node,w)>params.threshold;
}
/** The pixels the running entry's map spans, at its mip, of the error its subtree replaces
 *  (\`vsmDescentPixels\`): none where the map does not hold the node. */
fn vsmDescentReach(node:CullNode,w:u32)->f32{
 var high:vec4f;var low:vec3f;
 casterSphere(w,node.minimum,node.maximum,deformReach,&high,&low);
 let id=descentMap();
 if(!vsmDescentInMap(id,high,low)){return 0.0;}
 let stretch=bitcast<f32>(framesStretchBits(w));
 return vsmDescentPixels(id,descentMip(),vsmDescentBall(id,node,w,high,low),node.sphere.w*stretch,node.maxParentError*stretch);
}
/** A kept leaf's request priority: the reach of the error its pages replace over the threshold, as
 *  the camera's (\`leafPriority\`), at the shadow views' category; unbounded without a ceiling. */
fn vsmDescentPriority(node:CullNode,w:u32)->u32{
 let reach=select(FLOAT32_MAX,vsmDescentReach(node,w)/max(params.threshold,1e-30),node.maxParentError>=0.0);
 return ${requestPriorityOf(VSM_REQUEST_CATEGORY, 'reach')};
}
/** Whether the running entry's map does not hold a cell of the placement tree, its render-frame box
 *  \`lo\`..\`hi\` (the main view's eye taken off its world box, \`cellLow\`): its sphere carried to the
 *  map's shifted space by the eye. */
fn vsmDescentCellOutside(lo:vec3f,hi:vec3f)->bool{
 return !vsmDescentInMap(descentMap(),vsmDescentCellBall(lo,hi),vec3f(0.0));
}
/** The sphere of a cell's render-frame box in the world: the centre in single precision, whose
 *  roundings, a few units of its last place, grow the ball. */
fn vsmDescentCellBall(lo:vec3f,hi:vec3f)->vec4f{
 let world=0.5*(lo+hi)+cutView.cameraWorld;
 return vec4f(world,length(0.5*(hi-lo))*DESCENT_LOD_SLACK+DESCENT_SHIFT_SLACK*length(world));
}
/** Whether the pyramid of the running entry's map hides the box of a sphere (\`high\`, \`low\`, its
 *  centre \`prev\` further on where the previous image drew it) in its mip: in the main pass the
 *  previous frame's, tested where the previous image drew it, in both layers of the map; in the post
 *  pass this frame's, each layer's stale rect clipped as the cull clips it, and a layer with no
 *  page to draw under the box hides it. */`

const descentHiddenText = /* wgsl */ `
fn vsmDescentHidden(high:vec4f,low:vec3f,prev:vec3f)->bool{
 let h=vsmHandleFromId(descentMap());
 let pd=vsmProjectionOf(h);
 let mip=descentMip();
 let box=vsmDescentBox(pd,high,low);
 let texels=i32(VSM_LEVEL0_TEXELS>>mip);
 let nearClip=pd.lightKind!=LIGHT_KIND_DIRECTIONAL;
 if(cutPass()==CUT_POST){
  return vsmDescentHiddenNow(h,mip,box.cull,texels,true)&&vsmDescentHiddenNow(h,mip,box.cull,texels,false);
 }
 let centre=box.center+prev;
 return vsmHiddenBefore(pd,centre,box.extent,nearClip,mip,texels,true)&&vsmHiddenBefore(pd,centre,box.extent,nearClip,mip,texels,false);
}
/** The post pass's test in one layer of the map: the box's pixels clipped to the layer's stale rect,
 *  hidden if none is left or the pyramid hides every page of the layer's the box lies on. */
fn vsmDescentHiddenNow(h:VsmHandle,mip:u32,cull:VsmBoxInView,texels:i32,staticLayer:bool)->bool{
 let pixels=vsmClipToStaleRect(vsmRectPixels(vec4i(0,0,texels,texels),cull),h,mip,staticLayer,false);
 if(any(pixels.zw<pixels.xy)){return true;}
 let marks=select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,staticLayer);
 return vsmHiddenNow(h,mip,cull,texels,pixels,marks,staticLayer);
}
/** The verdict on the box \`lo\`..\`hi\` of placement \`w\` (\`NO_INDEX\`, a cell of the tree, a box of
 *  the render frame), grown by the deformation's reach, once it passed the running view's frustum
 *  and level of detail: seen where the previous frame holds no pyramid to test (the block's
 *  \`OCCLUSION_TWO_PASS\`); else hidden by the previous frame's, held for the post pass
 *  (\`BOX_OCCLUDED\`), or, in the post pass, hidden by this frame's, gone (\`BOX_CULLED\`). */
fn boxSight(lo:vec3f,hi:vec3f,w:u32)->u32{
 if((cutView.occlusion&OCCLUSION_TWO_PASS)==0u){return BOX_SEEN;}
 var high:vec4f;var low=vec3f(0.0);var prev=vec3f(0.0);
 if(w==NO_INDEX){
  high=vsmDescentCellBall(lo,hi);
 }else{
  casterSphere(w,lo,hi,deformReach,&high,&low);
  prev=vsmRenderPrevShift(w,0.5*(lo+hi),high.xyz,low);
 }
 if(!vsmDescentHidden(high,low,prev)){return BOX_SEEN;}
 return select(BOX_OCCLUDED,BOX_CULLED,cutPass()==CUT_POST);
}
/** The placement's pose at the main view's eye, as the casters read it. */`

const descentGateStubsText = /* wgsl */ `
fn viewWorld(w:u32)->mat4x4f{return worldsWorldAtEye(w,params.eye0,params.eye1);}
// The tests the casters' kernel makes of an object, a cluster at a time: none here (\`DAG_NO_GATES_WGSL\`).
/** A thread a light of the frame: its maps' views listed — a map and a mip of it, where the mip
 *  has a page to draw (\`vsmRenderMapMips\`) —, in the room the parameters name (\`viewCap\`). */`

const descentKernelsText = () => /* wgsl */ `
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_DESCENT_ENTRY.views}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let rank=flatIndex(id,n,WORKGROUP_THREADS);
 if(rank>=params.lightCount){return;}
 let light=lights[rank];
 let end=descentMapsEnd(light);
 var listed=0u;
 for(var map=light.x;map<end;map++){listed+=countOneBits(vsmRenderMapMips(map));}
 if(listed==0u){return;}
 var at=atomicAdd(&work[viewBase()],listed);
 for(var map=light.x;map<end;map++){
  var mips=vsmRenderMapMips(map);
  while(mips!=0u){
   let mip=firstTrailingBit(mips);
   mips&=mips-1u;
   if(at<params.viewCap){atomicStore(&work[viewBase()+1u+at],map|(mip<<16u));}
   at++;
  }
 }
}
/** The descent's reset and queue 0: the readout's counters, the lists', the pages' mask; then each
 *  view's roots, a thread a slot (\`rootSlots\` a view), as the camera's \`dagPrepare\` writes its own. */
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_DESCENT_ENTRY.prepare}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=flatIndex(id,n,WORKGROUP_THREADS);
 if(i==0u){
  atomicStore(&out.count,0u);atomicStore(&out.overflow,0u);atomicStore(&out.occluded,0u);atomicStore(&out.postHidden,0u);
  atomicStore(&out.frustumRejected,0u);atomicStore(&out.lodLevel,0u);resetCounters();
 }
 if(i<blockCount()){for(var k=0u;k<BLOCK_MASK_WORDS;k++){atomicStore(&work[drawMaskBase()+BLOCK_MASK_WORDS*i+k],0u);}}
 let slots=rootSlots();
 if(slots==0u||i/slots>=descentViews()){return;}
 descentView=i/slots;
 let r=i%slots;
 if(hasTree()){prepareTreeRoots(r);return;}
 openRoot(r,r);
}
/** Once a pass of the descent ran, the main pass or the post pass: the pages it listed (held to the
 *  room) for the casters' kernel, from the first this pass listed, and the casters found so far. */
@compute @workgroup_size(1) fn ${VSM_DESCENT_ENTRY.close}(){
 atomicStore(&counts[VSM_RENDER_COUNT_LISTED_FIRST],atomicLoad(&work[candFirstWord()]));
 atomicStore(&counts[VSM_RENDER_COUNT_LISTED],min(atomicLoad(&work[candCounter()]),cutView.candCap));
 atomicStore(&counts[VSM_RENDER_COUNT_CAST_FIRST],atomicLoad(&counts[0]));
}`

/** The shadow views' descent over `layout`'s VSM tables (above). */
export const vsmDescentWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${descentDeclarationsText()}${descentViewsText}${descentBallText()}${descentHiddenText}${descentGateStubsText}${descentKernelsText()}
`,
    [
      DAG_ACCESS_WGSL,
      DAG_RECORD_WGSL,
      dagLevelWgsl(VSM_DESCENT_SHAPE),
      dagListsWgsl(VSM_DESCENT_SHAPE),
      dagTreeDescentWgsl(VSM_DESCENT_SHAPE),
      dagPostPassWgsl(VSM_DESCENT_SHAPE),
      DAG_TREE_PREPARE_WGSL,
      DAG_WORLD_GATE_WGSL,
      DAG_NO_GATES_WGSL,
      DAG_CUT_PASS_WGSL,
      BLOCK_MASK_WORDS_WGSL,
      DAG_READING_WGSL,
      DAG_VIEWS_WGSL,
      DAG_ARM_WGSL,
      markReachWgsl,
      worldAtEyeWgsl('worlds'),
      VSM_CASTER_SPHERE_WGSL,
      VSM_PREV_SHIFT_WGSL,
      VSM_RENDER_VIEW_PIXELS_WGSL,
      VSM_RENDER_MAP_VIEW_WGSL,
      VSM_BOX_VIEW_WGSL,
      VSM_OCCLUSION_TEST_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      vsmBindingsWgsl(1, VSM_DESCENT_SPECS, layout),
      FLOAT32_MAX,
      bitMask,
      bitWord,
      ceilDivWgsl,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
