import { FLOAT32_MAX } from '../../../../../../math/src/wgsl/constants.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { CUT_RULE_WGSL } from '../../../../geometry/cut/rule.ts'
import { projectedBoundWgsl } from '../../../../geometry/dag/shader/projectedBoundWgsl.ts'
import { VSM_BOX_CULL_WGSL } from '../invalidation/boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_PAGE_MARKS_GATHER_WGSL } from '../pageGatherWgsl.ts'
import { VSM_HANDLE_WGSL } from '../pageTableWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
} from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslConst } from '../../../../../../math/src/wgsl/decl.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'
import { VSM_RENDER_OVERLAP_WGSL } from './renderOverlapWgsl.ts'
import { VSM_OCCLUSION_TEST_WGSL } from '../occlusion/occlusionTestWgsl.ts'

/**
 * THE SHADOW RASTER'S CULL: every caster the candidates list (`renderCandidatesWgsl.ts`) against
 * every map view of the view pass, in one dispatch, as the reference's cluster cull runs over every
 * view of a pass. The page overlap and page cache it reads
 * live in `renderOverlapWgsl.ts`, the box cull in `../invalidation/boxCullWgsl.ts`, the bin that
 * follows in `renderBinWgsl.ts`.
 *
 * A thread a (caster, listed light): the light's culling volume — a local light's range sphere, a
 * sun's far-shadow distance — once, then each of the light's listed maps (`vsmRenderCullView`): the
 * caster's layer, the map's frustum (the box frustum test with the dynamic depth cull range), then
 * each mip the map draws, a view of its own: the level of detail the view takes of the caster
 * (`vsmRenderLodAt`), its page rect clipped to the layer's stale rect, its overlap with a page to
 * draw (page-mark pyramid and receiver cover), and the rect walked by windows of
 * `VSM_RENDER_WINDOW_PAGES` pages a side: each page whose flags hold the caster's stale layer joins
 * the window, and a window with one such page at least is emitted, one record, clipped to them.
 * The record carries the window's pages in a mask: the raster
 * draws those alone, the bin marks them drawn.
 *
 * With the occlusion culling (`../occlusion/occlusionTestWgsl.ts`), the cull runs twice a view pass. The first
 * (`vsmRenderCullFirst`) tests each mip view that overlaps a page to draw against the previous
 * frame's pyramid: a caster hidden there emits nothing, marks nothing, and is held back — the
 * candidate, the view and the mip — from the end of the list (`vsmRenderHold`). The second
 * (`vsmRenderCullSecond`), once the first's records are drawn and the pyramid built over them, a
 * thread a record held back, culls that view and mip again — its level of detail as the first chose
 * it —, tests it against this frame's pyramid and emits it where visible. The post cull
 * (`vsmRenderCullPost`) does the same for the casters the descent found behind the nodes the
 * previous pyramid hid (`../traversal/`), a thread a caster and a listed light: their level of
 * detail chosen here, each mip view tested against this frame's pyramid. Without a previous
 * pyramid, one cull with no test (`vsmRenderCull`).
 *
 * Bounds: a world sphere per caster; the instance box is the sphere's axis-aligned box in shifted
 * space, and its radius the sphere's.
 */
/** Group 0 of `vsmRenderCull` (VSM resources of the current frame). */
export const VSM_RENDER_CULL_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageMarks', binding: 1 },
  { resource: 'receiverCover', binding: 2 },
  { resource: 'staleRects', binding: 3 },
  { resource: 'projectionData', binding: 4 },
]

/** The cull's `INF`, the bound `projectedBound` returns past the near plane: the greatest finite
 *  f32. */
const VSM_INF = wgslConst('INF', [FLOAT32_MAX], 'const INF:f32=FLOAT32_MAX;')

/** The pixels of a map's view an error spans (\`vsmRenderViewPixels\`): the cull's level of detail
 *  and the shadow views' descent's (\`../traversal/traversalWgsl.ts\`). */
export const VSM_RENDER_VIEW_PIXELS_WGSL = wgslBlock(
  'VSM_RENDER_VIEW_PIXELS_WGSL',
  [projectedBoundWgsl(VSM_INF)],
  `/** The pixels of a map's mip view an error \`error\` of a ball of shifted centre \`centre\` and world
 *  radius \`radius\` spans (\`projectedBound\`): the ball in the view's own space — its clip by
 *  \`toClip\`, the depth its weight and the side its x and y over the projection's scale —, \`focal\`
 *  the mip's pixels a unit at depth one (an orthographic view's a unit). */
fn vsmRenderViewPixels(error:f32,centre:vec3f,radius:f32,toClip:mat4x4f,viewToClip:mat4x4f,focal:f32,near:f32,perspective:f32)->f32{
 let clip=toClip*vec4f(centre,1.0);
 let v=vec3f(clip.x/viewToClip[0][0],clip.y/viewToClip[1][1],-clip.w);
 return projectedBound(error,v,radius,1.0,focal,near,perspective);
}
`,
)

/**
 * The layer a caster draws into in a map, the reference's cache-as-static decision made for it (the cull's,
 * \`vsmRenderCullView\`, and the shadow views' descent's, \`../traversal/traversalWgsl.ts\`): the static layer where the map
 * is cached and the caster is neither dynamic (\`dynamicCaster\`) nor cached as dynamic in the map's view (\`viewBits\` bit
 * \`viewSlot\`), else the dynamic one; one in the static layer whose cache state turned this frame (bit 16 + \`viewSlot\`)
 * draws into every wanted page. With the marks of the pages it draws into.
 */
export const VSM_CASTER_LAYER_WGSL = wgslBlock(
  'VSM_CASTER_LAYER_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_PROJECTION_DATA_WGSL],
  `struct VsmCasterLayer{staticLayer:bool,transitioned:bool,markMask:u32,}
fn vsmCasterLayer(dynamicCaster:bool,viewBits:u32,pd:VsmProjectionData)->VsmCasterLayer{
 let staticLayer=!pd.uncached&&!dynamicCaster&&((viewBits>>pd.viewSlot)&1u)==0u;
 let transitioned=staticLayer&&((viewBits>>(16u+pd.viewSlot))&1u)!=0u;
 let markMask=select(select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,staticLayer),VSM_PAGE_WANTED,transitioned);
 return VsmCasterLayer(staticLayer,transitioned,markMask);
}
`,
)

const cullBindingsText = /* wgsl */ `@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> views:array<vec4u>;
@group(1) @binding(2) var<storage,read> candidates:array<VsmRenderCandidate>;
@group(1) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(4) var<storage,read_write> records:array<vec4u>;
/**
 * Whether the raster emits the candidate's triangles in this map with corners 1 and 2 swapped, so
 * that a face toward the light is counter-clockwise on the framebuffer (\`vsmRenderVs\`). A
 * triangle's projected winding is its facing times the sign of D: for a perspective map, D = −det
 * of the UV matrix's u, v, w rows (the light at the shifted origin, those rows linear), for an
 * orthographic one det of its u, v, z rows (z toward the light, reversed Z); the page's NDC y and
 * the framebuffer's y each turn it once. Swapped where D < 0, against a row whose faces turn
 * (\`VSM_RENDER_CAND_FLIPPED\`); a two-sided row's second copy swaps once more.
 */
fn vsmRenderSwapped(m:mat4x4f,ortho:bool,flags:u32)->bool{
 let r3=select(vec3f(m[0].w,m[1].w,m[2].w),vec3f(m[0].z,m[1].z,m[2].z),ortho);
 let d=dot(vec3f(m[0].x,m[1].x,m[2].x),cross(vec3f(m[0].y,m[1].y,m[2].y),r3));
 return select(d>0.0,d<0.0,ortho)!=((flags&VSM_RENDER_CAND_FLIPPED)!=0u);
}
/** Whether a map's mip view draws the candidate of shifted centre \`centre\` at its own level of
 *  detail: the engine's cut rule (\`drawsCompared\`) on its group's error and its parent's, projected
 *  by the view and held to the shadows' threshold — each shadow view takes the cut it sees, as the
 *  reference's views each select their clusters. The verdict: not drawn, drawn at its own level of
 *  detail, or drawn though its error is over the threshold because the finer level is not resident —
 *  a level of detail behind what the view asks. */
fn vsmRenderLodAt(cand:VsmRenderCandidate,centre:vec3f,toClip:mat4x4f,viewToClip:mat4x4f,focal:f32,near:f32,perspective:f32)->u32{
 let parentAbove=cand.errors.y<0.0||vsmRenderViewPixels(cand.errors.y,centre+cand.parent.xyz,cand.parent.w,toClip,viewToClip,focal,near,perspective)>params.threshold;
 let ownWithin=vsmRenderViewPixels(cand.errors.x,centre+cand.own.xyz,cand.own.w,toClip,viewToClip,focal,near,perspective)<=params.threshold;
 if(!drawsCompared(true,parentAbove,ownWithin,(cand.flags&VSM_RENDER_CAND_CHILD_RESIDENT)!=0u)){return VSM_RENDER_LOD_NOT_DRAWN;}
 return select(VSM_RENDER_LOD_BEHIND,VSM_RENDER_LOD_OWN,ownWithin);
}
/** A place of the list, for a record to draw or one held back: false past its capacity, the place
 *  counted all the same (the frame's peak, \`vsmRenderArgsBin\`). */
fn vsmRenderTake()->bool{return atomicAdd(&counts[VSM_RENDER_COUNT_TAKEN],1u)<params.recordCapacity;}
/** A mip view the first cull holds back: candidate \`k\`, its view's
 *  place \`viewIndex\`, mip \`mipLevel\`, from the end of the list. */
fn vsmRenderHold(k:u32,viewIndex:u32,mipLevel:u32,directional:bool){
 if(!vsmRenderTake()){return;}
 let held=atomicAdd(&counts[VSM_RENDER_COUNT_HELD],1u);
 records[params.recordCapacity-1u-held]=vec4u(k,viewIndex,mipLevel|select(0u,1u<<8u,directional),0u);
}`

const cullSoftwareEmitText = /* wgsl */ `
/** Whether a caster is the software raster's in a map's mip view: its longest edge spans no more than \`params.hardwareEdge\` pixels at the nearest point of
 *  its level of detail's sphere — of its whole sphere where its vertices move — (\`vsmRenderViewPixels\`,
 *  the view's projection of the mip), its box crosses neither the near nor the far plane (\`cull\`),
 *  and it is neither tessellated nor a voxel row, which the hardware raster alone draws; none while
 *  the software raster is off (\`hardwareEdge\` 0) or the edge unknown. */
fn vsmRenderSoftware(cand:VsmRenderCandidate,centre:vec3f,toClip:mat4x4f,viewToClip:mat4x4f,focal:f32,near:f32,perspective:f32,cull:VsmBoxInView,tessellated:bool)->bool{
 if(params.hardwareEdge<=0.0||!(cand.edge>0.0)||tessellated||(cand.corners&VSM_RENDER_VOXEL_BIT)!=0u||cull.pastNear||cull.pastFar){return false;}
 let moving=(cand.flags&VSM_RENDER_CAND_MOVING)!=0u;
 let sphere=select(vec4f(centre+cand.own.xyz,cand.own.w),vec4f(centre,cand.c.w),moving);
 return vsmRenderViewPixels(cand.edge,sphere.xyz,sphere.w,toClip,viewToClip,focal,near,perspective)<=params.hardwareEdge;
}
/** The records of a caster's page rect \`pagesRect\` in map \`h\`'s mip \`mipLevel\`, a window of
 *  \`side\` pages a side at a time — \`VSM_RENDER_WINDOW_PAGES\` for the hardware raster, one for the
 *  software raster —: the pages whose flags hold the caster's stale
 *  layer (\`markMask\`) in the window's mask, the window clipped to them, and one record a window
 *  that holds one, its tier counted with it — none past the list's capacity, counted all the same. */
fn vsmRenderEmit(row:u32,word:u32,tier:u32,h:VsmHandle,mipLevel:u32,pagesRect:vec4u,markMask:u32,side:u32){
 let levelOffset=vsmTableLevelOrigin(h,mipLevel);
 for(var wy=pagesRect.y;wy<=pagesRect.w;wy+=side){
  for(var wx=pagesRect.x;wx<=pagesRect.z;wx+=side){
   let window=vec2u(wx,wy);
   let end=min(window+vec2u(side-1u),pagesRect.zw);
   var mask=0u;
   var first=end;
   var last=window;
   for(var y=wy;y<=end.y;y++){
    for(var x=wx;x<=end.x;x++){
     let page=vec2u(x,y);
     if((vsmPageMarkWord(vsmTableEntryAt(levelOffset,mipLevel,page))&markMask)==0u){continue;}
     mask|=1u<<((y-wy)*side+(x-wx));
     first=min(first,page);
     last=max(last,page);
    }
   }
   if(mask==0u){continue;}
   // A place of the list first, as a record held back takes one: the two never share a place, and
   // every place asked is counted (the frame's peak, \`vsmRenderArgsBin\`).
   if(!vsmRenderTake()){continue;}
   let slot=atomicAdd(&counts[VSM_RENDER_COUNT_RECORDS],1u);
   if(slot>=params.recordCapacity){continue;}
   atomicAdd(&counts[VSM_RENDER_TIER_RECORDS+tier],1u);
   // The mask from the clipped window's first page: every page it holds lies right of and below it.
   let shift=(first.y-wy)*side+(first.x-wx);
   records[slot]=vec4u(row,word,first.x|(first.y<<8u)|(last.x<<16u)|(last.y<<24u),mask>>shift);
  }
 }
}`

const cullViewHeadText = /* wgsl */ `
/**
 * One caster (candidate \`k\`) against one listed map of a light that holds it (\`vsmRenderCull\`), the
 * map at \`viewIndex\` in \`views\`: the map's layer, its frustum, then per mip its level of detail,
 * its page rect and its records — with the occlusion's first cull (\`kind\`), held back where the
 * previous frame's pyramid hides it; its second culls the mip \`onlyMip\` alone, its level of detail
 * as the first chose it, and leaves out what this frame's pyramid hides.
 */
fn vsmRenderCullView(cand:VsmRenderCandidate,k:u32,viewIndex:u32,directional:bool,kind:u32,onlyMip:u32){
 let view=views[viewIndex];
 let h=vsmHandleFromId(view.x);
 let pd=vsmProjectionOf(h);
 let nearClip=!directional;
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let shiftedToClip=vsmShiftedToClip(pd.shiftedToMapUv);
 let center=(cand.c.xyz+pd.originShiftHigh)+(cand.l+pd.originShiftLow);
 let radius=cand.c.w;
 // The static layer takes a caster that stands still (the engine's mobility) in a cached map; a
 // moving one draws into the dynamic layer: its mobility decides it, frame by frame.
 // A caster cached as dynamic in this view (its placement's per-view bit) draws as one that moves, as
 // does every cluster of a placement whose offset this map allows and whose object lets it invalidate.
 let offsetAlways=(cand.flags&VSM_RENDER_CAND_OFFSET_ALWAYS)!=0u;
 let offsetKept=(cand.flags&VSM_RENDER_CAND_OFFSET_KEEPS)!=0u;
 let offsetEvaluated=(cand.flags&VSM_RENDER_CAND_OFFSET)!=0u;
 // Whether the offset is allowed in this map: always, else the object evaluates it and the map's
 // level is not past the distance the object stops at.
 let offsetAllowed=offsetAlways||(offsetEvaluated&&(cand.offsetDisableSq<=0.0||pd.wpoThreshold<=cand.offsetDisableSq));
 let placementAllowed=(cand.flags&VSM_RENDER_CAND_PLACEMENT_OFFSET)!=0u
  &&((cand.flags&VSM_RENDER_CAND_PLACEMENT_ALWAYS)!=0u||cand.offsetDisableSq<=0.0||pd.wpoThreshold<=cand.offsetDisableSq);
 let layer=vsmCasterLayer(placementAllowed||(cand.flags&(VSM_RENDER_CAND_DYNAMIC|VSM_RENDER_CAND_DEFORMING))!=0u,cand.viewBits,pd);
 let staticLayer=layer.staticLayer;
 // One that changed its cache state this frame redraws every page it overlaps, the stale ones of both layers.
 let transitioned=layer.transitioned;
 // The receiver cover and the mark mask depend on the cache state.
 let useCover=pd.useCover&&!staticLayer;
 let markMask=layer.markMask;
 // A view with no stale page of the caster's layer draws nothing of it (\`vsmRenderViews\`).
 if((view.w&select(1u,2u,staticLayer))==0u){return;}`

const cullViewFrustumText = /* wgsl */ `
 // Frustum cull; non-static geometry also within the depth range (0, the largest float).
 let extent=vec3f(radius);
 let boxPoint=vsmBoxCullPoint(center,extent,isOrtho,nearClip);
 let cull=vsmBoxInView(shiftedToClip*vec4f(boxPoint,1.0),shiftedToClip[0],shiftedToClip[1],shiftedToClip[2],extent,viewToClip,isOrtho,nearClip);
 var visible=cull.inMapView;
 if(visible&&!staticLayer){
  visible=cull.clipHigh.z>0.0&&cull.clipLow.z<FLOAT32_MAX;
 }
 if(!visible){return;}
 // The pages it draws are invalidated as it draws them where it deforms, or where its offset is evaluated
 // now — within the distance of the main view — and its object lets it invalidate.
 let eyeCentre=cand.c.xyz+cand.l+cand.inst.xyz;
 let offsetNow=offsetEvaluated&&offsetAllowed&&(cand.offsetDisableSq<=0.0||dot(eyeCentre,eyeCentre)<cand.offsetDisableSq);
 let invalidates=(cand.flags&VSM_RENDER_CAND_DEFORMING)!=0u||((offsetNow||offsetAlways)&&!offsetKept);
 let offsetMarked=offsetAllowed&&!offsetKept;
 // A displaced surface goes to the tessellation where this kind of light's maps ask it.
 let tessKind=select(VSM_RENDER_TESSELLATE_LOCAL,VSM_RENDER_TESSELLATE_DIRECTIONAL,directional);
 let tessellated=(cand.flags&VSM_RENDER_CAND_TESSELLATED)!=0u&&(params.tessellated&tessKind)!=0u;
 let tier=vsmRenderTierOf(cand.corners);
 // A clipmap level (directional) has no near clip: bit 20, \`vsmRecordNoNearClip\`.
 let word=view.x|select(0u,1u<<20u,directional)|select(0u,1u<<21u,staticLayer)
  |select(0u,1u<<22u,vsmRenderSwapped(pd.shiftedToMapUv,isOrtho,cand.flags))
  |select(0u,1u<<23u,tessellated)|(tier<<24u)|select(0u,1u<<28u,invalidates)|select(0u,1u<<29u,offsetMarked);
 // The view's level of detail: the projection's scale in pixels a unit at depth one, its near plane.
 let perspective=select(1.0,0.0,isOrtho);
 let near=select(viewToClip[3][2]/(1.0-viewToClip[2][2]),0.0,isOrtho);
 let mips=min(view.y,VSM_MIPS);
 // The map's mips from its finest on: its table holds no finer one (\`vsmTableLevelOrigin\`).
 let focal=0.5*abs(viewToClip[1][1])*f32(VSM_LEVEL0_TEXELS>>pd.finestMip);
 // The object is judged whole, not by the cluster: it stays out of the coarse pages by its own ball's
 // footprint, the same for all its clusters; the cluster then takes every page its rect overlaps.
 let objectCentre=center+cand.inst.xyz;
 let objectExtent=vec3f(cand.inst.w);
 let objectPoint=vsmBoxCullPoint(objectCentre,objectExtent,isOrtho,nearClip);
 let objectCull=vsmBoxInView(shiftedToClip*vec4f(objectPoint,1.0),shiftedToClip[0],shiftedToClip[1],shiftedToClip[2],objectExtent,viewToClip,isOrtho,nearClip);
 // One radius for the object, the map's full resolution whatever the mip drawn (the instance cull's).
 let fineObject=vsmIsFineCaster(staticLayer,vsmClipRadius(isOrtho,cand.inst.w,objectCentre,viewToClip)*f32(VSM_LEVEL0_TEXELS));`

const cullViewMipsText = /* wgsl */ `
 // The second cull takes its one mip alone; the others, every mip from the finest.
 let second=kind==VSM_RENDER_CULL_SECOND;
 for(var mipLevel=select(pd.finestMip,onlyMip,second);mipLevel<select(mips,onlyMip+1u,second);mipLevel++){
  let mipFocal=focal*exp2(-f32(mipLevel-pd.finestMip));
  let levelTexels=i32(VSM_LEVEL0_TEXELS>>mipLevel);
  let pixels=vsmStalePixels(cull,h,mipLevel,staticLayer,transitioned);
  // The object first, by the pages it overlaps (the fine ones alone for a fine object), then the cluster.
  // Before the level of detail, which costs two projections: a mip with no page to draw asks none.
  let objectRect=vsmStalePixels(objectCull,h,mipLevel,staticLayer,transitioned);
  if(!vsmTouchesMappedPixels(h,mipLevel,objectRect,markMask,fineObject,useCover)){continue;}
  if(!vsmTouchesMappedPixels(h,mipLevel,pixels,markMask,false,useCover)){continue;}
  // The second cull keeps the level of detail the first chose; the verdict is asked of it only to
  // tell a level behind.
  var lod=VSM_RENDER_LOD_OWN;
  if(!second||vsm.lodDeltaInvalidates!=0u){
   lod=vsmRenderLodAt(cand,center,shiftedToClip,viewToClip,mipFocal,near,perspective);
  }
  if(!second&&lod==VSM_RENDER_LOD_NOT_DRAWN){continue;}
  // A cluster drawn behind marks the pages it is drawn into, to be invalidated when the finer level is resident.
  let lodBehind=vsm.lodDeltaInvalidates!=0u&&lod==VSM_RENDER_LOD_BEHIND;
  if(kind==VSM_RENDER_CULL_FIRST&&vsmHiddenBefore(pd,center+cand.prevShift,extent,nearClip,mipLevel,levelTexels,staticLayer)){
   vsmRenderHold(k,viewIndex,mipLevel,directional);
   continue;
  }
  if(kind>=VSM_RENDER_CULL_SECOND&&vsmHiddenNow(h,mipLevel,cull,levelTexels,pixels,markMask,staticLayer)){continue;}
  // The hardware raster's tier, or the software raster's bin and a window of one page.
  let software=vsmRenderSoftware(cand,center,shiftedToClip,viewToClip,mipFocal,near,perspective,cull,tessellated);
  let bin=select(tier,VSM_RENDER_SOFTWARE_BIN,software);
  vsmRenderEmit(cand.row,(word&~(15u<<24u))|(bin<<24u)|(mipLevel<<16u)|select(0u,1u<<30u,lodBehind),bin,h,mipLevel,vec4u(pixels)>>vec4u(VSM_LOG2_PAGE),markMask,select(VSM_RENDER_WINDOW_PAGES,1u,software));
 }
}`

const cullCandidateText = /* wgsl */ `
/** A caster against every listed map of its light (the first cull's, the post cull's or the cull
 *  with no test); the post cull's casters are those found since the descent's post pass opened. */
fn vsmRenderCullCandidate(wid:vec3u,nwg:vec3u,lane:u32,kind:u32){
 let first=select(0u,atomicLoad(&counts[VSM_RENDER_COUNT_CAST_FIRST]),kind==VSM_RENDER_CULL_POST);
 let k=first+flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(k>=atomicLoad(&counts[0])||wid.z>=min(atomicLoad(&counts[VSM_RENDER_COUNT_VIEWS]),params.lightCount)){return;}
 let cand=candidates[k];
 let listing=views[wid.z];
 let pd=vsmProjectionOf(vsmHandleFromId(listing.z));
 let directional=(listing.w&VSM_RENDER_VIEW_DIRECTIONAL)!=0u;
 // The objects that stand for a first-person one are drawn into the suns' first-person clipmaps and into
 // no other map, which hold every other object but them.
 if(((cand.flags&VSM_RENDER_CAND_WORLD_SPACE)!=0u)!=pd.firstPerson){return;}
 // A caster past a sun's far-shadow distance, along the main view, that does not cast far shadows,
 // is left out of every level of the sun's clipmap.
 if(directional&&vsmFarShadowSkipped(cand.flags,cand.farDepth,pd.farShadowEdge)){return;}
 // Local views enable distance cull and near clip.
 let center=(cand.c.xyz+pd.originShiftHigh)+(cand.l+pd.originShiftLow);
 let radius=cand.c.w;
 // Range-based culling distance = the light's radius: its culling volume, one for all its maps (they
 // share the light's origin and range).
 if(!directional&&dot(center,center)>(pd.lightRange+radius)*(pd.lightRange+radius)){return;}
 for(var run=0u;run<listing.y;run++){vsmRenderCullView(cand,k,params.lightCount+listing.x+run,directional,kind,0u);}
}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderCull(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 vsmRenderCullCandidate(wid,nwg,lane,VSM_RENDER_CULL_ALL);
}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderCullFirst(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 vsmRenderCullCandidate(wid,nwg,lane,VSM_RENDER_CULL_FIRST);
}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderCullPost(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 vsmRenderCullCandidate(wid,nwg,lane,VSM_RENDER_CULL_POST);
}
/** The second cull, a thread a record the first held back: its light's culling volume again,
 *  then its view and mip (\`vsmRenderCullView\`). */
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderCullSecond(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(i>=atomicLoad(&counts[VSM_RENDER_COUNT_HELD])){return;}
 let held=records[params.recordCapacity-1u-i];
 let cand=candidates[held.x];
 let directional=(held.z&(1u<<8u))!=0u;
 let pd=vsmProjectionOf(vsmHandleFromId(views[held.y].x));
 let center=(cand.c.xyz+pd.originShiftHigh)+(cand.l+pd.originShiftLow);
 let radius=cand.c.w;
 if(!directional&&dot(center,center)>(pd.lightRange+radius)*(pd.lightRange+radius)){return;}
 vsmRenderCullView(cand,held.x,held.y,directional,VSM_RENDER_CULL_SECOND,held.z&0xFFu);
}`

/**
 * `vsmRenderCull` and `vsmRenderCullFirst`: group 0 = `VSM_RENDER_CULL_SPECS`; group 1: 0 params
 * (uniform, dynamic), 1 views (vec4u: the listed lights' groups — run start, run length, first listed
 * map, flags —, then, from `params.lightCount`, their runs of listed maps — id, mip count, flags,
 * stale layers —, `vsmRenderViews`), 2 candidates, 3 counters (rw atomic), 4 records (rw). Dispatch:
 * x and y over the candidates (64 each), z = listed light (group) index. `vsmRenderCullSecond`: the
 * same groups, a thread a record held back (x and y). `vsmRenderCullPost`: over the candidates from
 * `VSM_RENDER_COUNT_CAST_FIRST`. The occlusion's three read group 2 (`VSM_OCCLUSION_GROUP`): the
 * pyramid and the kept tables — the previous frame's in the first, this frame's in the second and
 * the post cull.
 *
 * Record (vec4u, `VSM_RENDER_RECORD_WGSL`): x row; y VSM id | mip << 16 | no near clip << 20 |
 * static << 21 | swapped << 22 (`vsmRenderSwapped`) | tessellated << 23 | tier << 24 | deforms << 28;
 * z the window's first page x | y << 8 and its last page x << 16 | y << 24 (pages of the mip,
 * inclusive); w the window's pages to draw, bit (y · `VSM_RENDER_WINDOW_PAGES` + x) from its first.
 * A record held back, from the list's end: x the candidate, y its view's place in `views`, z the
 * mip | directional << 8.
 */
export const vsmRenderCullWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${cullBindingsText}${cullSoftwareEmitText}${cullViewHeadText}${cullViewFrustumText}${cullViewMipsText}${cullCandidateText}
`,
    [
      VSM_RENDER_OVERLAP_WGSL,
      VSM_OCCLUSION_TEST_WGSL,
      VSM_CASTER_LAYER_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      vsmBindingsWgsl(0, VSM_RENDER_CULL_SPECS, layout),
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_PAGE_MARKS_GATHER_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      VSM_BOX_CULL_WGSL,
      VSM_RENDER_VIEW_PIXELS_WGSL,
      CUT_RULE_WGSL,
      FLOAT32_MAX,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
