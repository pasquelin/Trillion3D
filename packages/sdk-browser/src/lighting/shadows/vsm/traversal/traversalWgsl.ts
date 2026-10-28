/**
 * THE SHADOW VIEWS' DESCENT: the camera's level-by-level descent of the cut hierarchy
 * (`../../../../geometry/dag/shader/levelWgsl.ts`, its lists, the placement tree's share) run over a
 * list of views, as the reference's persistent hierarchy culling runs over every view of a pass, each
 * candidate node carrying the view that tests it. The kernels are the camera's, written for a views
 * descent (`VSM_DESCENT_SHAPE`, `../../../../geometry/dag/shader/descentShape.ts`); what is the
 * shadow views' own is how a view tests a node.
 *
 * A VIEW is a map of a light and a mip of it that has a page to draw (`vsmDescentViews`: its stale
 * rect is not empty, `vsmRenderMapMips`), as the raster's views are (`render/renderViewsWgsl.ts`). Queue
 * 0 holds every view's roots — a placement's, or the placement tree's top nodes and the members
 * drawn whatever the view — and each level tests an entry's children against its view:
 * - in the view's map (`outsideFrustum`, `vsmDescentInMap`): a local light's range first, on the
 *   box's axis-aligned bound (`vsmCasterPastRange`, the casters' own), then the box itself, the
 *   oriented box the casters' kernel gives a cluster (`casterSphere`'s axes, `vsmCasterBoxInView`),
 *   against the map's box cull (`vsmBoxInView`): the box of a node holds the boxes of the clusters
 *   below it (the compiler's hierarchy is the box of their boxes), so what it misses they miss; a
 *   cell of the tree alike, its world box (`vsmDescentCellOutside`). The boxes of a placement are
 *   grown by the reach of its deformation, and by its offsets' only in the maps that allow them
 *   (`vsmDescentGrowth`), as the cull grows a cluster's;
 * - drawn in the layer its placement's casters draw into (`vsmDescentNotDrawn`): in the dynamic
 *   layer, within the map's dynamic depth range (`vsmCasterInDepthRange`, the cull's own test on
 *   the node's oriented box, whose clip depths hold its clusters'); then on a page to draw of the
 *   layer, looked for under the node's box (`vsmStalePixels`, the cull's own), and, in a map that
 *   keeps a receiver cover, over a receiver of it where the layer is not the static one
 *   (`vsmCasterUsesCover`, `vsmTouchesMappedPixels`, the cull's own); a cell of the tree is not
 *   tested, its placements are;
 * - its subtree needed at the view's mip (`vsmDescentNeeded`): the error its clusters replace
 *   (`maxParentError`) shown at the edge scale of the node's ball (`vsmRenderEdgeScale`), multiplied
 *   out as the cull's own comparison is (`vsmRenderErrorShows`). A scale that only grows as the ball
 *   holds more and the error does, so no node it drops holds a cluster the cull would draw in that
 *   mip (`vsmRenderLodAt` asks its parent's error to show). The error is taken at the placement's
 *   smallest axis scale (`minAxisScale`), as the cull and the camera's cut take it, the radius at
 *   its largest;
 * - a leaf not too coarse (`viewFloor`): a leaf none of whose clusters waits for a finer group
 *   (`childResident` of all its pages), whose floor (`minError`) shows past the threshold even at
 *   the ball's largest edge scale, is dropped, as the reference's cluster cull drops it
 *   (`cutMinLodCulling` turns it off): no cluster of it is drawn in that mip;
 * - not hidden by the pyramid of the view's map (`boxSight`): while the previous frame's pyramid and
 *   tables are kept (`OCCLUSION_TWO_PASS` in the block), the node's box, where the previous image
 *   drew it, is tested against that pyramid at the view's mip (`vsmHiddenBefore`, in both layers of
 *   the map): hidden, the node waits for the post pass
 *   (`BOX_OCCLUDED`, `postNode`, with its view) and its subtree is not walked. Once the main pass's
 *   clusters are drawn and the pyramid built over them, the post pass (`dagPostNodes`, `heldHere`
 *   the views of the running view pass) tests the nodes held again against this frame's
 *   (`vsmHiddenNow`): seen, a node enters queue 0 and every level runs again on it; hidden in both
 *   layers, it is gone. A box that hides holds every box under it, so no cluster the cull would
 *   draw is lost.
 * A kept leaf asks for its pages in each view that keeps it (`depositLeaf`, `requestPage`, the
 * shadow views' priority word, `vsmDescentPriority`, at the category the reference gives them),
 * and lists its resident pages once, whichever views keep it (`candAppend`): the casters' kernel
 * builds them (`../render/renderCandidatesWgsl.ts`; the post pass's, behind the main pass's) and the
 * cull judges each against every map of the view pass, its level of detail its own.
 *
 * What the casters' kernel tests of an object — the main view's filter, its draw distances, its
 * world's switch, a sun's far shadows, an assembly's parent group — is tested there, a cluster at a
 * time: the descent tests none of it (`filteredOut`, `outsideDrawDistance`, … none): it drops no
 * cluster the casters would keep.
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
import { DRAW_MASK_ACCESS_WGSL } from '../../../../geometry/dag/shader/drawMaskWgsl.ts'
import {
  BLOCK_MASK_WORDS_WGSL,
  DAG_FLOOR_GUARD_WGSL,
  FRAME_COUNTERS,
} from '../../../../geometry/dag/shader/floorWgsl.ts'
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
  MOBILITY_SHADOWLESS,
} from '../../mobilityBits.ts'
import { ROOT_WORDS_WGSL } from '../../casters/rootWordsWgsl.ts'
import { VSM_CONSTANTS_WGSL, VSM_LIGHT_WORDS } from '../constants.ts'
import { VSM_HANDLE_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL } from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_RENDER_PARAMS_WGSL } from '../render/renderParamsWgsl.ts'
import { vsmRenderOverlapBlock } from '../render/renderOverlapWgsl.ts'
import { vsmCasterLayerBlock, VSM_RENDER_EDGE_SCALE_WGSL } from '../render/renderCullWgsl.ts'
import { VSM_CASTER_SPHERE_WGSL, VSM_PREV_SHIFT_WGSL } from '../render/renderCandidatesWgsl.ts'
import { VSM_OCCLUSION_TEST_WGSL } from '../occlusion/occlusionTestWgsl.ts'
import { VSM_RENDER_MAP_VIEW_WGSL } from '../render/renderViewsWgsl.ts'

/** The shadow views' descent (`../../../../geometry/dag/shader/descentShape.ts`). */
export const VSM_DESCENT_SHAPE: DescentShape = {
  views: true,
  begin: 'vsmDescentBegin(w,node.minimum,node.maximum);',
  subtreeNeeded: 'vsmDescentNeeded(node,w)',
  cameraSubtree: false,
  floor: 'views',
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

/** The bits of a view's word (\`descentViewWord\`): its mip above the map's sixteen, the light's channels
 *  above the mip's three. */
const VIEW_MIP_SHIFT = 16
const VIEW_CHANNELS_SHIFT = VIEW_MIP_SHIFT + 3

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
/** The descent's \`work\`: the frame counters first (\`counterBase\`), the camera cut's, at the words
 *  its arming kernel reads whatever the cut; the views' list behind them — its count, then each
 *  view's map, mip and light's lighting channels (\`descentMap\`, \`descentMip\`, \`descentChannels\`),
 *  \`params.viewCap\` of them —; the frame's lights,
 *  \`VSM_LIGHT_WORDS\` words each, the raster's table of them (\`descentLight\`); then the pages'
 *  mask, a bit a packed page, which lists a page once (\`candAppend\`), a block of
 *  \`BLOCK_MASK_WORDS\` words a workgroup's pages. */
fn counterBase()->u32{return 0u;}
fn viewBase()->u32{return ${FRAME_COUNTERS}u;}
fn lightBase()->u32{return viewBase()+1u+params.viewCap;}
fn drawMaskBase()->u32{return lightBase()+${VSM_LIGHT_WORDS}u*params.lightCount;}
fn descentViews()->u32{return min(atomicLoad(&work[viewBase()]),params.viewCap);}
/** View \`view\`: the map in the low half of its word, its mip in the three bits above, the lighting
 *  channels of the map's light, as a mask, in the three above those. */
fn descentViewWord(view:u32)->u32{return atomicLoad(&work[viewBase()+1u+view]);}
/** The running entry's map, mip and light's channels. */
fn descentMap()->u32{return descentViewWord(descentView)&0xFFFFu;}
fn descentMip()->u32{return (descentViewWord(descentView)>>${VIEW_MIP_SHIFT}u)&7u;}
fn descentChannels()->u32{return (descentViewWord(descentView)>>${VIEW_CHANNELS_SHIFT}u)&LIGHTING_CHANNELS_ALL;}
/** Light \`rank\` of the frame: its first map's id and its map count. */
fn descentLight(rank:u32)->vec2u{
 let at=lightBase()+${VSM_LIGHT_WORDS}u*rank;
 return vec2u(atomicLoad(&work[at]),atomicLoad(&work[at+1u]));
}
/** Light \`rank\`'s lighting channels, as a mask (\`vsmWriteLights\`). */
fn descentLightChannels(rank:u32)->u32{return atomicLoad(&work[lightBase()+${VSM_LIGHT_WORDS}u*rank+2u]);}
fn descentMapsEnd(light:vec2u)->u32{return min(light.x+light.y,vsm.mapCount);}
/** Whether view \`view\`, held for the post pass, is a map of the view pass running (\`params.viewFirst\`,
 *  \`params.viewCount\`: the ids of its maps), whose pyramid the pass has just built. */
fn heldHere(view:u32)->bool{
 let map=descentViewWord(view)&0xFFFFu;
 return map>=params.viewFirst&&map<params.viewFirst+params.viewCount;
}
/** The box of shifted world centre \`high\` + \`low\` and world half axes \`axes\` in map space \`pd\`'s:
 *  its centre, its half axes and its box cull as the cull takes a cluster's (\`vsmRenderCullViews\`), with
 *  the map's shifted-to-clip matrix it is taken by. */`

const descentViewsText = /* wgsl */ `
struct VsmDescentBox{center:vec3f,axes:array<vec3f,3>,shiftedToClip:mat4x4f,cull:VsmBoxInView,high:vec4f,low:vec3f,}
fn vsmDescentBox(pd:VsmProjectionData,high:vec4f,low:vec3f,axes:array<vec3f,3>)->VsmDescentBox{
 var box:VsmDescentBox;
 box.high=high;
 box.low=low;
 box.axes=axes;
 box.shiftedToClip=vsmShiftedToClip(pd.shiftedToMapUv);
 box.center=vsmShiftedCentre(high.xyz,low,pd);
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let nearClip=pd.lightKind!=LIGHT_KIND_DIRECTIONAL;
 box.cull=vsmCasterBoxInView(box.center,axes[0],axes[1],axes[2],box.shiftedToClip,viewToClip,isOrtho,nearClip);
 return box;
}
/** Whether map \`pd\` holds the box of shifted world centre \`high\` + \`low\` and half axes \`axes\`: a
 *  local light's range on the box, then the map's box cull, the cull's own (\`vsmRenderCullCandidate\`,
 *  \`vsmRenderCullViews\`), on the box. */
fn vsmDescentInMap(pd:VsmProjectionData,high:vec4f,low:vec3f,axes:array<vec3f,3>)->bool{
 return vsmDescentBoxInMap(pd,vsmDescentBox(pd,high,low,axes));
}
/** Whether map \`pd\` holds a node's box \`box\` (\`vsmDescentInMap\`). */
fn vsmDescentBoxInMap(pd:VsmProjectionData,box:VsmDescentBox)->bool{
 if(pd.lightKind!=LIGHT_KIND_DIRECTIONAL&&vsmCasterPastRange(box.center,box.axes[0],box.axes[1],box.axes[2],pd.lightRange)){return false;}
 return box.cull.inMapView;
}
/** A node's ball (its \`sphere\`) centre in the shifted space of the map \`box\` is of, from the
 *  box's centre: the placement's linear part on the node's offset from the box's centre, as the
 *  casters lay a cluster's (\`vsmRenderCaster\`). */
fn vsmDescentBall(box:VsmDescentBox,node:CullNode,w:u32)->vec3f{
 return box.center+worldsLinear(w)*(node.sphere.xyz-(node.minimum+node.maximum)*0.5);
}
`

/** The growth of a placement's bounds and its box in a map's space. */
const descentGrowthText = `
/** The reach that grows the bounds of placement \`w\` in the map of wpo threshold \`wpoThreshold\`, from
 *  its mark's whole reach \`deformReach\` (the deformation's and the offsets' together): the whole
 *  where the map grows them by the offsets' (\`vsmOffsetGrows\`, the cull's rule for the placement's
 *  casters), else the deformation's alone (\`vsmBareReach\`). */
fn vsmDescentGrowth(w:u32,wpoThreshold:f32)->f32{
 let roots=vsmRootWords(w);
 if(vsmOffsetGrows((roots.word&${MOBILITY_OFFSET_INVALIDATES}u)!=0u,(roots.word&${MOBILITY_OFFSET_ALWAYS}u)!=0u,roots.disableSq,wpoThreshold)){return deformReach;}
 return vsmBareReach(roots,deformReach);
}
/** The box \`lo\`..\`hi\` of placement \`w\` in map \`pd\`'s space, grown by \`growth\`, the reach the map
 *  allows (\`vsmDescentGrowth\`), with its sphere. */
fn vsmDescentBoxOf(pd:VsmProjectionData,w:u32,lo:vec3f,hi:vec3f,growth:f32)->VsmDescentBox{
 var high:vec4f;var low:vec3f;var axes:array<vec3f,3>;
 casterSphere(w,lo,hi,growth,&high,&low,&axes);
 return vsmDescentBox(pd,high,low,axes);
}`

/** What the running entry's view holds of a node's box, and whether it draws any of it. */
const descentViewText = (
  prefiltered: boolean,
) => `/** What the running entry's view holds of a node's box: whether the placement is out of the view for
 *  want of a lighting channel the light shares (\`shut\`, the other fields then unset), its map's record,
 *  the box in that map (grown by the reach \`growth\` the map allows), the lens of its mip and, once a
 *  hook asks them, the edge scales of the node's ball (\`vsmDescentScales\`). A node is tested by
 *  several hooks in a row — the frustum, the subtree, the floor, the pyramid, the priority —, so the
 *  view is built once for the node (\`vsmDescentBegin\`, which the level runs before them) and kept. */
struct VsmDescentView{shut:bool,pd:VsmProjectionData,box:VsmDescentBox,lens:VsmViewLens,growth:f32,scales:vec2f,scaled:bool,}
var<private> descentHeld:VsmDescentView;
/** Whether placement \`w\` casts none into the running entry's map: its word says it casts no shadow into the maps
 *  (\`MOBILITY_SHADOWLESS\`), or it shares no lighting channel with the map's light. None of its clusters is walked, as the
 *  reference's instance cull drops it before them. A cell of the tree is not tested, its placements are. */
fn vsmDescentChannelMismatch(w:u32)->bool{
 if(w>=vsmRootCount()){return false;}
 let word=vsmRootWords(w).word;
 return (word&${MOBILITY_SHADOWLESS}u)!=0u||(vsmRootChannels(word)&descentChannels())==0u;
}
/** Makes \`descentHeld\` the running entry's view of the node box \`lo\`..\`hi\` of placement \`w\`; a
 *  placement that casts none into the map or is in none of the light's channels (\`vsmDescentChannelMismatch\`) is shut,
 *  and builds none. */
fn vsmDescentBegin(w:u32,lo:vec3f,hi:vec3f){
 descentHeld.shut=vsmDescentChannelMismatch(w);
 if(descentHeld.shut){return;}
 let pd=vsmProjectionOf(vsmHandleFromId(descentMap()));
 let growth=vsmDescentGrowth(w,pd.wpoThreshold);
 descentHeld=VsmDescentView(false,pd,vsmDescentBoxOf(pd,w,lo,hi,growth),vsmViewLens(pd.lightViewToClip,descentMip()),growth,vec2f(0.0),false);
}
/** Whether the running entry's map does not hold the box \`lo\`..\`hi\` of placement \`w\`, grown by the
 *  reach the map allows (\`vsmDescentBoxInMap\`: the frustum and the range on the oriented box), or
 *  draws none of the clusters under it (\`vsmDescentNotDrawn\`), or the placement is shut. */
fn outsideFrustum(w:u32,lo:vec3f,hi:vec3f)->bool{
 return descentHeld.shut||!vsmDescentBoxInMap(descentHeld.pd,descentHeld.box)||vsmDescentNotDrawn(w,descentHeld.pd.handle,descentHeld.pd,descentHeld.box);
}
/** Whether the running entry's view of map \`h\` (\`pd\`) draws none of the clusters of placement \`w\`
 *  under the node box \`box\`, in the layer the placement draws into (\`vsmCasterLayer\`, the cull's
 *  rule, decided for the placement as the reference decides it for an instance): a placement cached
 *  still whose surfaces wear an offset that may invalidate has its clusters that evaluate it in the
 *  dynamic layer too. A cell of the tree (no placement) draws something. */
fn vsmDescentNotDrawn(w:u32,h:VsmHandle,pd:VsmProjectionData,box:VsmDescentBox)->bool{
 if(w>=vsmRootCount()){return false;}
 let roots=vsmRootWords(w);
 let layer=vsmCasterLayer((roots.word&${MOBILITY_MOVING | MOBILITY_DEFORMS}u)!=0u,roots.viewBits,pd);
 if(vsmDescentDraws(h,pd,box,layer)){return false;}
 if(!layer.staticLayer||(roots.word&${MOBILITY_OFFSET_INVALIDATES}u)==0u){return true;}
 return !vsmDescentDraws(h,pd,box,vsmCasterLayer(true,roots.viewBits,pd));
}
/** Whether a caster under the node box \`box\` could be drawn into map \`h\`'s (\`pd\`) mip of the running
 *  entry in layer \`layer\`, as the cull asks a caster's: the dynamic layer within the map's dynamic
 *  depth range, and a page of the layer to draw under the box (its fine pages taken too) over a
 *  receiver of the cover where the map keeps one and the layer is not the static one
 *  (\`vsmRenderCullViews\`'s \`useCover\`). */
fn vsmDescentDraws(h:VsmHandle,pd:VsmProjectionData,box:VsmDescentBox,layer:VsmCasterLayer)->bool{
 if(!vsmCasterInDepthRange(layer,box.cull,pd)){return false;}
 let mip=descentMip();
 return vsmTouchesMappedPixels(h,mip,vsmStalePixels(box.cull,h,mip,layer.staticLayer,layer.transitioned),${prefiltered ? 'vsmCasterMarkMask(layer,box.cull,pd)' : 'layer.markMask'},false,vsmCasterUsesCover(layer,pd));
}`

/** The scales of a node's ball and whether its error shows. */
const descentScalesText = `/** The smallest and the largest edge scale of the ball of node \`node\` of placement \`w\` in the running
 *  entry's mip view (\`vsmRenderEdgeScales\`), the radius at the placement's largest stretch, projected
 *  once for the node; the view \`descentHeld\` is the node's. */
fn vsmDescentScales(node:CullNode,w:u32)->vec2f{
 if(!descentHeld.scaled){
  let stretch=bitcast<f32>(framesStretchBits(w));
  let box=descentHeld.box;
  descentHeld.scales=vsmRenderEdgeScales(vsmDescentBall(box,node,w),node.sphere.w*stretch,box.shiftedToClip,descentHeld.pd.lightViewToClip,descentHeld.lens);
  descentHeld.scaled=true;
 }
 return descentHeld.scales;
}
/** Whether the error \`error\` of node \`node\` of placement \`w\` shows in the running entry's mip view
 *  (\`vsmRenderErrorShows\`), the error taken at the placement's smallest axis scale as the cull and
 *  the camera's cut take it. */
fn vsmDescentShows(node:CullNode,w:u32,error:f32)->bool{
 return vsmRenderErrorShows(vsmDescentScales(node,w).x,error*minAxisScale(worldsLinear(w)),descentHeld.lens.focal);
}
/** The pixels the running entry's map spans of the error the subtree of \`node\` replaces, the
 *  reference's priority of a node (its threshold over the edge scale): none where the map does not
 *  hold the node (\`vsmDescentBoxInMap\`), unbounded for a ball wholly behind the near plane. */
fn vsmDescentReach(node:CullNode,w:u32)->f32{
 if(!vsmDescentBoxInMap(descentHeld.pd,descentHeld.box)){return 0.0;}
 let scale=vsmDescentScales(node,w).x;
 if(!(scale>0.0)){return FLOAT32_MAX;}
 return node.maxParentError*minAxisScale(worldsLinear(w))*descentHeld.lens.focal/scale;
}
/** Whether the running entry's view needs the subtree of \`node\`: the error it replaces shows (\`vsmDescentShows\`),
 *  or none bounds it; a node the map does not hold is not. */
fn vsmDescentNeeded(node:CullNode,w:u32)->bool{
 if(node.maxParentError<0.0){return true;}
 return vsmDescentBoxInMap(descentHeld.pd,descentHeld.box)&&vsmDescentShows(node,w,node.maxParentError);
}`

/** Whether a leaf's groups are closed, the view floor and the request priority. */
const descentClosedText = `/** Whether every cluster of the pages \`first\` to \`first + count\`, a leaf's, has its finer group
 *  resident: none waits for it. A leaf that does is kept (the reference's sign of \`MinLODError\`). */
fn vsmDescentClosed(first:u32,count:u32)->bool{
 for(var k=0u;k<count;k++){if(!childResident(first+k)){return false;}}
 return true;
}
/** Whether the running entry's view drops the leaf \`node\` as too coarse (\`cutMinLodCulling\`): its
 *  floor (\`minError\`) shows even at the largest edge scale of its ball, \`far · t < focal · floor\`
 *  multiplied out as the reference's cluster cull has it — and no cluster of it waits for a finer
 *  group. The clusters of such a leaf are all drawn at their parents' level in this mip. The scale is
 *  asked before the pages, which are many reads. */
fn viewFloor(node:CullNode,w:u32)->bool{
 if(!floorApplies(node)){return false;}
 if(!(vsmDescentScales(node,w).y*params.threshold<descentHeld.lens.focal*node.minError*minAxisScale(worldsLinear(w)))){return false;}
 return vsmDescentClosed(pageBaseOf(w)+node.firstPage,node.pageCount);
}
/** A kept leaf's request priority: the reach of the error its pages replace over the threshold, as
 *  the camera's (\`leafPriority\`), at the shadow views' category; unbounded without a ceiling. */
fn vsmDescentPriority(node:CullNode,w:u32)->u32{
 var reach=FLOAT32_MAX;
 if(node.maxParentError>=0.0){reach=vsmDescentReach(node,w)/max(params.threshold,1e-30);}
 return ${requestPriorityOf(VSM_REQUEST_CATEGORY, 'reach')};
}`

/** A cell of the placement tree against the running entry's map. */
const descentCellText = `/** Whether the running entry's map does not hold a cell of the placement tree, its render-frame box
 *  \`lo\`..\`hi\` (the main view's eye taken off its world box, \`cellLow\`): its box and its sphere
 *  carried to the map's shifted space by the eye. */
fn vsmDescentCellOutside(lo:vec3f,hi:vec3f)->bool{
 return !vsmDescentInMap(vsmProjectionOf(vsmHandleFromId(descentMap())),vsmDescentCellBall(lo,hi),vec3f(0.0),vsmDescentCellAxes(lo,hi));
}
/** The half axes of a cell's render-frame box: its half extents on the world's axes. */
fn vsmDescentCellAxes(lo:vec3f,hi:vec3f)->array<vec3f,3>{
 let side=0.5*(hi-lo);
 return array<vec3f,3>(vec3f(side.x,0.0,0.0),vec3f(0.0,side.y,0.0),vec3f(0.0,0.0,side.z));
}
/** The sphere of a cell's render-frame box in the world. */
fn vsmDescentCellBall(lo:vec3f,hi:vec3f)->vec4f{
 let world=0.5*(lo+hi)+cutView.cameraWorld;
 return vec4f(world,length(0.5*(hi-lo)));
}
/** Whether the pyramid of map \`h\` (\`pd\`) hides the box \`box\` of the running entry (its centre
 *  \`prev\` further on and its half axes \`prevAxes\` where the previous image drew it) in its mip: in the
 *  main pass the previous frame's, the box tested where the previous image drew it (the casters'
 *  cull tests a cluster so: \`vsmHiddenBefore\`), in both layers of the map; in the post
 *  pass this frame's, each layer's stale rect clipped as the cull clips it, and a layer with no
 *  page to draw under the box hides it. */`

const descentBallText = (prefiltered: boolean) =>
  /* wgsl */ `${descentGrowthText}\n${descentViewText(prefiltered)}\n${descentScalesText}\n${descentClosedText}\n${descentCellText}`

const descentHiddenText = /* wgsl */ `
fn vsmDescentHidden(h:VsmHandle,pd:VsmProjectionData,box:VsmDescentBox,prev:vec3f,prevAxes:array<vec3f,3>)->bool{
 let mip=descentMip();
 let texels=i32(VSM_LEVEL0_TEXELS>>mip);
 let nearClip=pd.lightKind!=LIGHT_KIND_DIRECTIONAL;
 if(cutPass()==CUT_POST){
  return vsmDescentHiddenNow(h,mip,box.cull,texels,true)&&vsmDescentHiddenNow(h,mip,box.cull,texels,false);
 }
 if(!vsmPrevViewHolds(pd,mip)){return false;}
 let cull=vsmPrevBoxInView(pd,box.center+prev,prevAxes[0],prevAxes[1],prevAxes[2],nearClip);
 return vsmHiddenBefore(pd,cull,mip,texels,true)&&vsmHiddenBefore(pd,cull,mip,texels,false);
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
 var hidden:bool;
 if(w==NO_INDEX){
  let pd=vsmProjectionOf(h);
  let box=vsmDescentBox(pd,vsmDescentCellBall(lo,hi),vec3f(0.0),vsmDescentCellAxes(lo,hi));
  hidden=vsmDescentHidden(h,pd,box,vec3f(0.0),box.axes);
 }else{
  let box=descentHeld.box;
  // The box where the previous image drew it: its centre moved, its half axes the current ones unless
  // the placement's linear part changed.
  var prevAxes=box.axes;
  if(!vsmRenderPrevStill(w)){vsmRenderPrevAxes(w,lo,hi,descentHeld.growth,&prevAxes);}
  hidden=vsmDescentHidden(h,descentHeld.pd,box,vsmRenderPrevShift(w,0.5*(lo+hi),box.high.xyz,box.low),prevAxes);
 }
 if(!hidden){return BOX_SEEN;}
 return select(BOX_OCCLUDED,BOX_CULLED,cutPass()==CUT_POST);
}`

const descentGateStubsText = /* wgsl */ `
// The tests the casters' kernel makes of an object, a cluster at a time: none here (\`DAG_NO_GATES_WGSL\`).
`

const descentKernelsText = () => /* wgsl */ `
/** A thread a light of the frame: its maps' views listed — a map and a mip of it, where the mip
 *  has a page to draw (\`vsmRenderMapMips\`) —, in the room the parameters name (\`viewCap\`). */
@compute @workgroup_size(WORKGROUP_THREADS) fn ${VSM_DESCENT_ENTRY.views}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let rank=flatIndex(id,n,WORKGROUP_THREADS);
 if(rank>=params.lightCount){return;}
 let light=descentLight(rank);
 let end=descentMapsEnd(light);
 let channels=descentLightChannels(rank)<<${VIEW_CHANNELS_SHIFT}u;
 var listed=0u;
 for(var map=light.x;map<end;map++){listed+=countOneBits(vsmRenderMapMips(map));}
 if(listed==0u){return;}
 var at=atomicAdd(&work[viewBase()],listed);
 for(var map=light.x;map<end;map++){
  var mips=vsmRenderMapMips(map);
  while(mips!=0u){
   let mip=firstTrailingBit(mips);
   mips&=mips-1u;
   if(at<params.viewCap){atomicStore(&work[viewBase()+1u+at],map|(mip<<${VIEW_MIP_SHIFT}u)|channels);}
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
${descentDeclarationsText()}${descentViewsText}${descentBallText(layout.prefilteredDistant)}${descentHiddenText}${descentGateStubsText}${descentKernelsText()}
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
      DAG_FLOOR_GUARD_WGSL,
      DAG_READING_WGSL,
      DAG_VIEWS_WGSL,
      DAG_ARM_WGSL,
      markReachWgsl,
      worldAtEyeWgsl('worlds'),
      VSM_CASTER_SPHERE_WGSL,
      VSM_PREV_SHIFT_WGSL,
      VSM_RENDER_EDGE_SCALE_WGSL,
      VSM_RENDER_MAP_VIEW_WGSL,
      vsmRenderOverlapBlock(layout.prefilteredDistant),
      VSM_BOX_VIEW_WGSL,
      VSM_CASTER_BOX_CULL_WGSL,
      vsmCasterLayerBlock(layout.prefilteredDistant),
      VSM_OCCLUSION_TEST_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      vsmBindingsWgsl(1, VSM_DESCENT_SPECS, layout),
      FLOAT32_MAX,
      DRAW_MASK_ACCESS_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
