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
 * - in the view's map (`outsideFrustum`, `vsmDescentInMap`): a local light's range first, on the
 *   box's world sphere (`casterSphere`, the casters' own) with its radius doubled — the sphere of a
 *   box within it lies within it —, then the box itself, the oriented box the casters' kernel gives a
 *   cluster (`casterSphere`'s axes, `vsmCasterBoxInView`), against the map's box cull
 *   (`vsmBoxInView`): the box of a node holds the boxes of the clusters below it (the compiler's
 *   hierarchy is the box of their boxes), so what it misses they miss; a cell of the tree alike, its
 *   world box (`vsmDescentCellOutside`). The boxes of a placement are grown by the reach of its
 *   deformation, and by its offsets' only in the maps that allow them (`vsmDescentGrowth`), as the
 *   cull grows a cluster's;
 * - drawn in the layer its placement's casters draw into (`vsmDescentNotDrawn`): in the dynamic
 *   layer, within the map's dynamic depth range (`vsmCasterInDepthRange`, the cull's own test on
 *   the node's oriented box, whose clip depths hold its clusters'); then on a page to draw of the
 *   layer, looked for under the cube about the node's sphere doubled (`vsmDescentCube`), not the
 *   oriented box, and, in a map that keeps a receiver cover, over a receiver of it where the layer
 *   is not the static one (`vsmCasterUsesCover`, `vsmTouchesMappedPixels`, the cull's own); a cell of
 *   the tree is not tested, its placements are;
 * - its subtree needed at the view's mip (`vsmDescentNeeded`): the greatest error its clusters
 *   replace (`maxParentError`) over the node's ball, projected by the mip as the cull projects a
 *   cluster's (`vsmRenderViewPixels`), past the shadows' threshold. A projection that only grows as
 *   the ball holds more and the error does, so no node it drops holds a cluster the cull would draw
 *   in that mip (`vsmRenderLodAt` asks its parent's error to show). The error is taken at the
 *   placement's smallest axis scale (`minAxisScale`), as the cull and the camera's cut take
 *   it, the radius at its largest;
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
 * (`out`, the requests), its `work` (which also holds the frame's lights, copied in at the start of
 * the frame, `descentLight`), the worlds, the frame words, the cold words, the tree, the poses the
 * previous image drew. Group 1: 0 the raster's parameters (uniform, dynamic), 1 the maps' records,
 * 2 the stale rects, 3 the receiver cover, 4 the raster's counters (rw atomic), 5 the VSM uniforms,
 * 6 the page marks, 8 the placements' words (`rootWords`): eight storage buffers in all, the most a
 * stage is sure to hold. Group 2: the occlusion's (`VSM_OCCLUSION_TEST_WGSL`), the previous frame's
 * pyramid and tables in the main pass, this frame's in the post pass.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FLOAT32_MAX } from '../../../../../../math/src/wgsl/constants.ts'
import { unitOrZero } from '../../../../../../math/src/wgsl/inverseTranspose.ts'
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
import { DAG_AXIS_SCALES_WGSL } from '../../../../geometry/dag/shader/primitiveWgsl.ts'
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
import {
  VSM_BOX_VIEW_WGSL,
  VSM_CASTER_BOX_CULL_WGSL,
  VSM_OFFSET_GROWS_WGSL,
} from '../invalidation/boxCullWgsl.ts'
import {
  MOBILITY_DEFORMS,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_INVALIDATES,
} from '../../mobilityBits.ts'
import { ROOT_WORDS_WGSL } from '../../casters/rootWordsWgsl.ts'
import { VSM_CONSTANTS_WGSL, VSM_LIGHT_WORDS } from '../constants.ts'
import { VSM_HANDLE_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_RENDER_PARAMS_WGSL } from '../render/renderParamsWgsl.ts'
import { VSM_RENDER_OVERLAP_WGSL } from '../render/renderOverlapWgsl.ts'
import { VSM_CASTER_LAYER_WGSL, VSM_RENDER_VIEW_PIXELS_WGSL } from '../render/renderCullWgsl.ts'
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
  { resource: 'pageMarks', binding: 6 },
  { resource: 'receiverCover', binding: 3 },
]

/** The category of the shadow views' requests, the priority word's top two bits: the reference's
 *  for a virtual shadow map's views, below the camera's (`REQUEST_CATEGORY`). */
const VSM_REQUEST_CATEGORY = 0

/** A box's sphere doubled: the sphere of any box within the box lies within it — its centre in the
 *  box, its radius no greater —, grown past the roundings of the two spheres (`casterSphere`). What
 *  the tests that stay on a sphere or its cube hold a node by: a local light's range, the pages to
 *  draw (`vsmDescentCube`) and the previous image's occlusion (`vsmHiddenBefore`), which the casters'
 *  cull makes on the cube about a cluster's sphere. */
const DESCENT_BALL_GROWTH = 2 + 2 ** -16
/** What a node's projection is raised by against its clusters': the roundings of its shifted
 *  centre beside theirs; what a cell's half extents and sphere are raised by (`vsmDescentCellAxes`,
 *  `vsmDescentCellBall`): the roundings of its corners. */
const DESCENT_LOD_SLACK = 1 + 2 ** -10
/** The roundings of a shifted centre, relative to its distance from the map's origin: the box's
 *  centre is summed in single precision beside the cluster's, each off by 2^-24 of it, so the box
 *  grows by this (2^6 times that) to hold what its clusters' boxes hold. */
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
@group(1) @binding(4) var<storage,read_write> counts:array<atomic<u32>>;
/** The placements' words (\`../../casters/rootWords.ts\`): the mobility words, the instances' state
 *  per view, the offsets' distances and the deformations' reach, a section each
 *  (\`vsmRootWords\`). */
@group(1) @binding(8) var<storage,read> rootWords:array<u32>;
const DESCENT_BALL_GROWTH:f32=${wgslF32(DESCENT_BALL_GROWTH)};
const DESCENT_LOD_SLACK:f32=${wgslF32(DESCENT_LOD_SLACK)};
const DESCENT_SHIFT_SLACK:f32=${wgslF32(DESCENT_SHIFT_SLACK)};
/** The descent's \`work\`: the frame counters first (\`counterBase\`), the camera cut's, at the words
 *  its arming kernel reads whatever the cut; the views' list behind them — its count, then each
 *  view's map and mip (\`descentMap\`, \`descentMip\`), \`params.viewCap\` of them —; the frame's lights,
 *  \`VSM_LIGHT_WORDS\` words each, the raster's table of them (\`descentLight\`); then the pages'
 *  mask, a bit a packed page, which lists a page once (\`candAppend\`), a block of
 *  \`BLOCK_MASK_WORDS\` words a workgroup's pages. */
fn counterBase()->u32{return 0u;}
fn viewBase()->u32{return ${FRAME_COUNTERS}u;}
fn blockCount()->u32{return ceilDiv(cutView.clusterCount,WORKGROUP_THREADS);}
fn lightBase()->u32{return viewBase()+1u+params.viewCap;}
fn drawMaskBase()->u32{return lightBase()+${VSM_LIGHT_WORDS}u*params.lightCount;}
fn drawMaskWord(i:u32)->u32{return drawMaskBase()+bitWord(i);}
fn drawBit(i:u32)->u32{return bitMask(i);}
fn descentViews()->u32{return min(atomicLoad(&work[viewBase()]),params.viewCap);}
/** View \`view\`: the map in the low half of its word, its mip in the high half. */
fn descentViewWord(view:u32)->u32{return atomicLoad(&work[viewBase()+1u+view]);}
/** The running entry's map and mip. */
fn descentMap()->u32{return descentViewWord(descentView)&0xFFFFu;}
fn descentMip()->u32{return descentViewWord(descentView)>>16u;}
/** Light \`rank\` of the frame: its first map's id and its map count. */
fn descentLight(rank:u32)->vec2u{
 let at=lightBase()+${VSM_LIGHT_WORDS}u*rank;
 return vec2u(atomicLoad(&work[at]),atomicLoad(&work[at+1u]));
}
fn descentMapsEnd(light:vec2u)->u32{return min(light.x+light.y,vsm.mapCount);}
/** Whether view \`view\`, held for the post pass, is a map of the view pass running (\`params.viewFirst\`,
 *  \`params.viewCount\`: the ids of its maps), whose pyramid the pass has just built. */
fn heldHere(view:u32)->bool{
 let map=descentViewWord(view)&0xFFFFu;
 return map>=params.viewFirst&&map<params.viewFirst+params.viewCount;
}
/** The box of shifted world centre \`high\` + \`low\` and world half axes \`axes\` in map space \`pd\`'s:
 *  its centre and its box cull as the cull takes a cluster's (\`vsmRenderCullView\`), each axis grown
 *  by the roundings of the shifted centre, with the map's shifted-to-clip matrix it is taken by; and
 *  the half side of the cube about its sphere (\`high.w\`) doubled, \`extent\`, for the tests that
 *  stay on a sphere or a cube (\`vsmDescentCube\`). */`

const descentViewsText = /* wgsl */ `
struct VsmDescentBox{center:vec3f,extent:vec3f,shiftedToClip:mat4x4f,cull:VsmBoxInView,high:vec4f,low:vec3f,}
/** Axis \`a\` longer by \`by\` along itself; one of no length has no direction (a node's axes carry the
 *  margin of \`casterSphere\`, a cell's the extent of its box). */
fn vsmDescentGrown(a:vec3f,by:f32)->vec3f{
 return a+unitOrZero(a)*by;
}
fn vsmDescentBox(pd:VsmProjectionData,high:vec4f,low:vec3f,axes:array<vec3f,3>)->VsmDescentBox{
 var box:VsmDescentBox;
 box.high=high;
 box.low=low;
 box.shiftedToClip=vsmShiftedToClip(pd.shiftedToMapUv);
 box.center=(high.xyz+pd.originShiftHigh)+(low+pd.originShiftLow);
 let slack=DESCENT_SHIFT_SLACK*length(box.center);
 box.extent=vec3f(high.w*DESCENT_BALL_GROWTH+slack);
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let nearClip=pd.lightKind!=LIGHT_KIND_DIRECTIONAL;
 box.cull=vsmCasterBoxInView(box.center,vsmDescentGrown(axes[0],slack),vsmDescentGrown(axes[1],slack),vsmDescentGrown(axes[2],slack),box.shiftedToClip,viewToClip,isOrtho,nearClip);
 return box;
}
/** The cull of the cube of half side \`box.extent.x\` about the node's sphere doubled, in map \`pd\`'s
 *  space: what the pages under a node are looked for by (\`vsmDescentNotDrawn\`). */
fn vsmDescentCube(pd:VsmProjectionData,box:VsmDescentBox)->VsmBoxInView{
 let r=box.extent.x;
 let viewToClip=pd.lightViewToClip;
 return vsmCasterBoxInView(box.center,vec3f(r,0.0,0.0),vec3f(0.0,r,0.0),vec3f(0.0,0.0,r),box.shiftedToClip,viewToClip,viewToClip[3][3]>=1.0,pd.lightKind!=LIGHT_KIND_DIRECTIONAL);
}
/** Whether map \`pd\` holds the box of shifted world centre \`high\` + \`low\` and half axes \`axes\`
 *  (sphere radius \`high.w\`): a local light's range on the sphere doubled, then the map's box cull,
 *  the cull's own (\`vsmRenderCullCandidate\`, \`vsmRenderCullView\`), on the box. */
fn vsmDescentInMap(pd:VsmProjectionData,high:vec4f,low:vec3f,axes:array<vec3f,3>)->bool{
 return vsmDescentBoxInMap(pd,vsmDescentBox(pd,high,low,axes));
}
/** Whether map \`pd\` holds a node's box \`box\` (\`vsmDescentInMap\`). */
fn vsmDescentBoxInMap(pd:VsmProjectionData,box:VsmDescentBox)->bool{
 let reach=pd.lightRange+box.extent.x;
 if(pd.lightKind!=LIGHT_KIND_DIRECTIONAL&&dot(box.center,box.center)>reach*reach){return false;}
 return box.cull.inMapView;
}
/** The pixels map \`pd\`'s mip \`mip\` spans of an error \`error\` over the ball of shifted centre
 *  \`centre\` and radius \`radius\`, \`shiftedToClip\` the map's matrix (\`vsmRenderViewPixels\`), raised
 *  by the roundings. */
fn vsmDescentPixels(pd:VsmProjectionData,shiftedToClip:mat4x4f,mip:u32,centre:vec3f,radius:f32,error:f32)->f32{
 let pixels=vsmRenderViewPixels(error,centre,radius+DESCENT_SHIFT_SLACK*length(centre),shiftedToClip,pd.lightViewToClip,vsmViewLens(pd.lightViewToClip,mip));
 return pixels*DESCENT_LOD_SLACK;
}
/** A node's ball (its \`sphere\`) centre in the shifted space of the map \`box\` is of, from the
 *  box's centre: the placement's linear part on the node's offset from the box's centre, as the
 *  casters lay a cluster's (\`vsmRenderCaster\`). */
fn vsmDescentBall(box:VsmDescentBox,node:CullNode,w:u32)->vec3f{
 return box.center+worldsLinear(w)*(node.sphere.xyz-(node.minimum+node.maximum)*0.5);
}
`

const descentBallText = () => /* wgsl */ `
/** The reach that grows the bounds of placement \`w\` in the map of wpo threshold \`wpoThreshold\`, from
 *  its mark's whole reach \`deformReach\` (the deformation's and the offsets' together): the whole
 *  where the map grows them by the offsets' (\`vsmOffsetGrows\`, the cull's rule for the placement's
 *  casters), else the deformation's alone (\`vsmBareReach\`). */
fn vsmDescentGrowth(w:u32,wpoThreshold:f32)->f32{
 let roots=vsmRootWords(w);
 if(vsmOffsetGrows((roots.word&${MOBILITY_OFFSET_INVALIDATES}u)!=0u,(roots.word&${MOBILITY_OFFSET_ALWAYS}u)!=0u,roots.disableSq,wpoThreshold)){return deformReach;}
 return vsmBareReach(roots,deformReach);
}
/** The box \`lo\`..\`hi\` of placement \`w\` in map \`pd\`'s space, grown by the reach the map allows,
 *  with its sphere. */
fn vsmDescentBoxOf(pd:VsmProjectionData,w:u32,lo:vec3f,hi:vec3f)->VsmDescentBox{
 var high:vec4f;var low:vec3f;var axes:array<vec3f,3>;
 casterSphere(w,lo,hi,vsmDescentGrowth(w,pd.wpoThreshold),&high,&low,&axes);
 return vsmDescentBox(pd,high,low,axes);
}
/** Whether the running entry's map does not hold the box \`lo\`..\`hi\` of placement \`w\`, grown by the
 *  reach the map allows (\`vsmDescentBoxInMap\`: the frustum on the oriented box, the range on the
 *  sphere doubled), or draws none of the clusters under it (\`vsmDescentNotDrawn\`). */
fn outsideFrustum(w:u32,lo:vec3f,hi:vec3f)->bool{
 let h=vsmHandleFromId(descentMap());
 let pd=vsmProjectionOf(h);
 let box=vsmDescentBoxOf(pd,w,lo,hi);
 return !vsmDescentBoxInMap(pd,box)||vsmDescentNotDrawn(w,h,pd,box);
}
/** Whether the running entry's view of map \`h\` (\`pd\`) draws none of the clusters of placement \`w\`
 *  under the node box \`box\`, in the layer the placement draws into (\`vsmCasterLayer\`, the cull's
 *  rule, decided for the placement as the reference decides it for an instance): a placement cached
 *  still whose surfaces wear an offset that may invalidate has its clusters that evaluate it in the
 *  dynamic layer too. A cell of the tree (no placement) draws something. */
fn vsmDescentNotDrawn(w:u32,h:VsmHandle,pd:VsmProjectionData,box:VsmDescentBox)->bool{
 if(w>=vsmRootCount()){return false;}
 let roots=vsmRootWords(w);
 let cube=vsmDescentCube(pd,box);
 let layer=vsmCasterLayer((roots.word&${MOBILITY_MOVING | MOBILITY_DEFORMS}u)!=0u,roots.viewBits,pd);
 if(vsmDescentDraws(h,pd,box,cube,layer)){return false;}
 if(!layer.staticLayer||(roots.word&${MOBILITY_OFFSET_INVALIDATES}u)==0u){return true;}
 return !vsmDescentDraws(h,pd,box,cube,vsmCasterLayer(true,roots.viewBits,pd));
}
/** Whether a caster under the node box \`box\` (\`cube\`: the cube about its sphere doubled) could be
 *  drawn into map \`h\`'s (\`pd\`) mip of the running entry in layer \`layer\`, as the cull asks a
 *  caster's: the dynamic layer within the map's dynamic depth range, and a page of the layer to draw
 *  under the cube (its fine pages taken too) over a receiver of the cover where the map keeps one and
 *  the layer is not the static one (\`vsmRenderCullView\`'s \`useCover\`). */
fn vsmDescentDraws(h:VsmHandle,pd:VsmProjectionData,box:VsmDescentBox,cube:VsmBoxInView,layer:VsmCasterLayer)->bool{
 if(!vsmCasterInDepthRange(layer,box.cull,pd)){return false;}
 let mip=descentMip();
 return vsmTouchesMappedPixels(h,mip,vsmStalePixels(cube,h,mip,layer.staticLayer,layer.transitioned),layer.markMask,false,vsmCasterUsesCover(layer,pd));
}
/** The pixels the running entry's map spans, at its mip, of an error \`error\` of node \`node\` of
 *  placement \`w\` (\`vsmDescentPixels\`), the error taken at the placement's smallest axis scale as
 *  the cull and the camera's cut take it, the radius at its largest; \`box\` the node's in map \`pd\`. */
fn vsmDescentSeen(pd:VsmProjectionData,box:VsmDescentBox,node:CullNode,w:u32,error:f32)->f32{
 let stretch=bitcast<f32>(framesStretchBits(w));
 return vsmDescentPixels(pd,box.shiftedToClip,descentMip(),vsmDescentBall(box,node,w),node.sphere.w*stretch,error*minAxisScale(worldsLinear(w)));
}
/** The pixels the running entry's map spans of the error the subtree of \`node\` replaces: none where
 *  the map does not hold the node (\`vsmDescentBoxInMap\`). */
fn vsmDescentReach(node:CullNode,w:u32)->f32{
 let pd=vsmProjectionOf(vsmHandleFromId(descentMap()));
 let box=vsmDescentBoxOf(pd,w,node.minimum,node.maximum);
 if(!vsmDescentBoxInMap(pd,box)){return 0.0;}
 return vsmDescentSeen(pd,box,node,w,node.maxParentError);
}
/** Whether the running entry's view sees the error \`node\`'s subtree replaces past the threshold
 *  (\`vsmDescentReach\`), or none bounds it. */
fn vsmDescentNeeded(node:CullNode,w:u32)->bool{
 if(node.maxParentError<0.0){return true;}
 return vsmDescentReach(node,w)>params.threshold;
}
/** A kept leaf's request priority: the reach of the error its pages replace over the threshold, as
 *  the camera's (\`leafPriority\`), at the shadow views' category; unbounded without a ceiling. */
fn vsmDescentPriority(node:CullNode,w:u32)->u32{
 var reach=FLOAT32_MAX;
 if(node.maxParentError>=0.0){reach=vsmDescentReach(node,w)/max(params.threshold,1e-30);}
 return ${requestPriorityOf(VSM_REQUEST_CATEGORY, 'reach')};
}
/** Whether the running entry's map does not hold a cell of the placement tree, its render-frame box
 *  \`lo\`..\`hi\` (the main view's eye taken off its world box, \`cellLow\`): its box and its sphere
 *  carried to the map's shifted space by the eye. */
fn vsmDescentCellOutside(lo:vec3f,hi:vec3f)->bool{
 return !vsmDescentInMap(vsmProjectionOf(vsmHandleFromId(descentMap())),vsmDescentCellBall(lo,hi),vec3f(0.0),vsmDescentCellAxes(lo,hi));
}
/** The half axes of a cell's render-frame box: its half extents on the world's axes, grown by the
 *  roundings of its corners. */
fn vsmDescentCellAxes(lo:vec3f,hi:vec3f)->array<vec3f,3>{
 let side=0.5*(hi-lo)*DESCENT_LOD_SLACK;
 return array<vec3f,3>(vec3f(side.x,0.0,0.0),vec3f(0.0,side.y,0.0),vec3f(0.0,0.0,side.z));
}
/** The sphere of a cell's render-frame box in the world: the centre in single precision, whose
 *  roundings, a few units of its last place, grow the ball. */
fn vsmDescentCellBall(lo:vec3f,hi:vec3f)->vec4f{
 let world=0.5*(lo+hi)+cutView.cameraWorld;
 return vec4f(world,length(0.5*(hi-lo))*DESCENT_LOD_SLACK+DESCENT_SHIFT_SLACK*length(world));
}
/** Whether the pyramid of map \`h\` (\`pd\`) hides the box \`box\` of the running entry (its sphere's
 *  centre \`prev\` further on where the previous image drew it) in its mip: in the
 *  main pass the previous frame's, the cube about the sphere doubled tested where the previous image
 *  drew it (the casters' cull tests a cluster so: \`vsmHiddenBefore\`), in both layers of the map; in the post
 *  pass this frame's, each layer's stale rect clipped as the cull clips it, and a layer with no
 *  page to draw under the box hides it. */`

const descentHiddenText = /* wgsl */ `
fn vsmDescentHidden(h:VsmHandle,pd:VsmProjectionData,box:VsmDescentBox,prev:vec3f)->bool{
 let mip=descentMip();
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
 let pixels=vsmStalePixels(cull,h,mip,staticLayer,false);
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
 let h=vsmHandleFromId(descentMap());
 let pd=vsmProjectionOf(h);
 var box:VsmDescentBox;
 var prev=vec3f(0.0);
 if(w==NO_INDEX){
  box=vsmDescentBox(pd,vsmDescentCellBall(lo,hi),vec3f(0.0),vsmDescentCellAxes(lo,hi));
 }else{
  box=vsmDescentBoxOf(pd,w,lo,hi);
  prev=vsmRenderPrevShift(w,0.5*(lo+hi),box.high.xyz,box.low);
 }
 if(!vsmDescentHidden(h,pd,box,prev)){return BOX_SEEN;}
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
 let light=descentLight(rank);
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
      VSM_OFFSET_GROWS_WGSL,
      ROOT_WORDS_WGSL,
      DAG_AXIS_SCALES_WGSL,
      DAG_CUT_PASS_WGSL,
      BLOCK_MASK_WORDS_WGSL,
      DAG_READING_WGSL,
      DAG_VIEWS_WGSL,
      DAG_ARM_WGSL,
      markReachWgsl,
      unitOrZero,
      worldAtEyeWgsl('worlds'),
      VSM_CASTER_SPHERE_WGSL,
      VSM_PREV_SHIFT_WGSL,
      VSM_RENDER_VIEW_PIXELS_WGSL,
      VSM_RENDER_MAP_VIEW_WGSL,
      VSM_RENDER_OVERLAP_WGSL,
      VSM_BOX_VIEW_WGSL,
      VSM_CASTER_BOX_CULL_WGSL,
      VSM_CASTER_LAYER_WGSL,
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
