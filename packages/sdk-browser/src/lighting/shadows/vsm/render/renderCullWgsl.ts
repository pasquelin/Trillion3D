import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { CUT_RULE_WGSL } from '../../../../geometry/cut/rule.ts'
import { DAG_EDGE_SCALES_WGSL } from '../../../../geometry/dag/shader/error.ts'
import {
  vsmBoxCullBlock,
  VSM_BOX_VIEW_WGSL,
  VSM_CASTER_BOX_CULL_WGSL,
  VSM_OFFSET_GROWS_WGSL,
  VSM_VIEW_LENS_WGSL,
} from '../invalidation/boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_PAGE_MARKS_GATHER_WGSL } from '../pageGatherWgsl.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_PAGE_LOOKUP_WGSL } from '../pageTableWgsl.ts'
import { prefilteredDeps } from '../prefilteredWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
} from '../projection/projectionDataWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslVariants } from '../../../../../../math/src/wgsl/decl.ts'
import {
  VSM_FEEDBACK_WGSL,
  VSM_RENDER_PARAMS_WGSL,
  VSM_RENDER_RECORD_WGSL,
} from './renderParamsWgsl.ts'
import { vsmRenderOverlapBlock } from './renderOverlapWgsl.ts'
import { VSM_OCCLUSION_TEST_WGSL } from '../occlusion/occlusionTestWgsl.ts'
import { LIGHTING_CHANNELS_WGSL } from '../../../lightingChannelsWgsl.ts'

/**
 * THE SHADOW RASTER'S CULL: every caster the candidates list (`renderCandidatesWgsl.ts`) against
 * every map of the view pass, in one dispatch. The page overlap and page cache it reads
 * live in `renderOverlapWgsl.ts`, the box cull in `../invalidation/boxCullWgsl.ts`, the bin that
 * follows in `renderBinWgsl.ts`.
 *
 * A thread a (caster, listed map): the lighting channels the two share (a caster in none of the
 * light's casts none into its maps), the light's culling volume — a local light's range sphere, a
 * sun's far-shadow distance — then the map's listed mip views (`vsmRenderCullViews`): the caster's
 * layer, and the map's frustum (the box frustum test with the dynamic depth cull range) once for all its
 * views, then,
 * for each mip, a view of its own: the level of detail the view takes of the caster
 * (`vsmRenderLodAt`), its page rect clipped to the layer's stale rect, its overlap with a page to
 * draw (page-mark pyramid and receiver cover), and the rect walked by windows of
 * `VSM_RENDER_WINDOW_PAGES` pages a side (`VSM_RENDER_WINDOW_PAGES_SOFTWARE` for the software raster): each page whose flags
 * hold the caster's stale layer joins the window, and a window with one such page at least is
 * emitted, one record, its rect clipped to them. Where the device binds the page table and the raster
 * marks in the cull (`vsmCullMarks`), each page that joins a window is marked drawn there, as the
 * cull marks a page it keeps, and the rect is clipped to the pages that are ones to draw at
 * their level; otherwise the bin that follows marks the pages of the record's rect (`renderBinWgsl.ts`).
 * The raster draws the record's rect in the pages to draw (`vsmRenderPoolTexel`).
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
 * Bounds: a world sphere and a world box per caster. The map's frustum, the light's range, the depth
 * range, the page rect and the previous image's occlusion test all cull the box (its centre and three
 * half axes; the previous image's under the placement's previous pose); the level of detail and the
 * raster choice measure the sphere, and the instance's ball
 * (\`inst\`) is the object's, judged whole.
 */
/** Group 0 of `vsmRenderCull` (VSM resources of the current frame). */
export const VSM_RENDER_CULL_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageMarks', binding: 1 },
  { resource: 'receiverCover', binding: 2 },
  { resource: 'staleRects', binding: 3 },
  { resource: 'projectionData', binding: 4 },
]

/** Group 0 of `vsmRenderCull` where the cull marks the pages it emits drawn (`vsmCullMarks`): the page table, which says
 *  which pages are mapped and which are ones to draw, and the raster marks. */
const VSM_RENDER_CULL_MARKING_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'pageTable', binding: 5 },
  { resource: 'rasterMarks', binding: 6, access: 'read_write' },
]

/** Group 0 of `vsmRenderCull`, by whether the cull marks the pages drawn (`marks`). */
export const vsmRenderCullSpecs = (marks: boolean): readonly VsmBindingSpec[] =>
  marks ? [...VSM_RENDER_CULL_SPECS, ...VSM_RENDER_CULL_MARKING_SPECS] : VSM_RENDER_CULL_SPECS

/** The raster marks a drawn page takes, and their store: the cull's (`vsmRenderEmit`) or, on a device
 *  that gives it too few storage buffers, the bin's (`renderBinWgsl.ts`). */
export const VSM_RASTER_MARKS_WGSL = wgslBlock(
  'VSM_RASTER_MARKS_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_PAGE_ADDRESS_WGSL],
  `/** The raster marks a drawn page takes: its static or dynamic drawn bit; where the caster invalidates
 *  the page, its stale bit of the layer, else where an offset is allowed on it the offset bit (16); and,
 *  additively, the bit of a level of detail behind (32). */
fn vsmRasterMarkBits(staticLayer:bool,staleAfter:bool,offsetAllowed:bool,lodBehind:bool)->u32{
 var flags=select(1u,2u,staticLayer);
 if(staleAfter){
  flags|=select(4u,8u,staticLayer);
 }else if(offsetAllowed){
  flags|=16u;
 }
 if(lodBehind){flags|=32u;}
 return flags;
}
/** Marks a physical page drawn. */
fn vsmMarkDrawnPage(page:VsmTableEntry,markBits:u32){
 if(!page.thisLevelMapped){return;}
 let drawnPool=vsmPoolIndexOf(page.physicalAddress);
 let n=vsm.poolPages;
 for(var s=0u;s<VSM_DIRTY_SLICES;s++){
  if((markBits&(1u<<s))!=0u){vsmRasterMarksStore(n*s+drawnPool,1u);}
 }
}
`,
)

/** The edge scale and the error comparison of a map's mip view, as the camera's cut makes them (`edgeScalesAt`, `errorShows`): multiplied out, no division. The cull's
 *  level of detail and raster choice and the shadow views' descent's (`../traversal/traversalWgsl.ts`). */
export const VSM_RENDER_EDGE_SCALE_WGSL = wgslBlock(
  'VSM_RENDER_EDGE_SCALE_WGSL',
  [DAG_EDGE_SCALES_WGSL, VSM_VIEW_LENS_WGSL],
  `/** The projected edge scales — the smallest and the largest, over the ball, of a point's depth times the
 *  cosine of its angle to the axis (\`edgeScalesAt\`, the camera cut's own) — of the ball of shifted
 *  centre \`centre\` and world radius \`radius\` in a map's view: the ball in the view's own space, its
 *  clip by \`toClip\`, the depth its weight and the side its x and y over the projection's scale. Zero
 *  for a ball wholly behind the near plane; \`lens\` any mip's (the near plane and the kind of view are
 *  the view's). A scale is the mip's own to read: an error spans \`error · lens.focal / scale\` pixels. */
fn vsmRenderEdgeScales(centre:vec3f,radius:f32,toClip:mat4x4f,viewToClip:mat4x4f,lens:VsmViewLens)->vec2f{
 let clip=toClip*vec4f(centre,1.0);
 let v=vec3f(clip.x/viewToClip[0][0],clip.y/viewToClip[1][1],-clip.w);
 return edgeScalesAt(v,radius,lens.near,lens.perspective);
}
/** The smallest of them: what the level of detail and the raster choice are judged at. */
fn vsmRenderEdgeScale(centre:vec3f,radius:f32,toClip:mat4x4f,viewToClip:mat4x4f,lens:VsmViewLens)->f32{
 return vsmRenderEdgeScales(centre,radius,toClip,viewToClip,lens).x;
}
/** Whether an error \`error\` shows at edge scale \`scale\` of a view whose pixels per unit at depth one
 *  are \`focal\`, at the shadows' threshold: \`scale · t <= focal · error\`, the threshold multiplied
 *  out, a zero error never (the camera's \`errorShows\`). */
fn vsmRenderErrorShows(scale:f32,error:f32,focal:f32)->bool{
 return error>0.0&&scale*params.threshold<=focal*error;
}
`,
)

/** In a level of a prefiltered distant shadow, every caster, static or not, is cut by the level's band
 *  (`dynamicDepthCullRange`: its inner and outer clip depth) and not by the dynamic range: it is drawn
 *  where it reaches in front of the band's outer end. */
const PREFILTERED_DEPTH_RANGE_TEXT = ` if(vsmMapPrefiltered(pd)){return cull.clipLow.z<pd.dynamicDepthCullRange.y;}
`

/** A caster wholly inside the band's inner end (past it from the light) is drawn into the pages the view
 *  asked alone: its mask asks `VSM_PAGE_PRIMARY` of the pages. */
const PREFILTERED_MARK_MASK_TEXT = `
/** The marks a caster of layer \`layer\` asks of the pages it draws into in map \`pd\`: its layer's, and
 *  in a level of a prefiltered distant shadow the primary request where its box \`cull\` lies wholly
 *  inside the band's inner end. */
fn vsmCasterMarkMask(layer:VsmCasterLayer,cull:VsmBoxInView,pd:VsmProjectionData)->u32{
 if(vsmMapPrefiltered(pd)&&cull.clipHigh.z<pd.dynamicDepthCullRange.x){return layer.markMask|VSM_PAGE_PRIMARY;}
 return layer.markMask;
}`

/**
 * The layer a caster draws into in a map, the cache-as-static decision made for it (the cull's,
 * \`vsmRenderCullViews\`, and the shadow views' descent's, \`../traversal/traversalWgsl.ts\`): the static layer where the map
 * is cached and the caster is neither dynamic (\`dynamicCaster\`) nor cached as dynamic in the map's view (\`viewBits\` bit
 * \`viewSlot\`), else the dynamic one; one in the static layer whose cache state turned this frame (bit 16 + \`viewSlot\`)
 * draws into every wanted page. With the marks of the pages it draws into, and the two tests the layer
 * decides: the dynamic layer's within the map's dynamic depth range (\`vsmCasterInDepthRange\`) and the
 * receiver cover's, asked of every layer but the static one (\`vsmCasterUsesCover\`).
 */
const casterLayerText = (
  prefiltered: boolean,
) => `struct VsmCasterLayer{staticLayer:bool,transitioned:bool,markMask:u32,}
fn vsmCasterLayer(dynamicCaster:bool,viewBits:u32,pd:VsmProjectionData)->VsmCasterLayer{
 let staticLayer=!pd.uncached&&!dynamicCaster&&((viewBits>>pd.viewSlot)&1u)==0u;
 let transitioned=staticLayer&&((viewBits>>(16u+pd.viewSlot))&1u)!=0u;
 let markMask=select(select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,staticLayer),VSM_PAGE_WANTED,transitioned);
 return VsmCasterLayer(staticLayer,transitioned,markMask);
}
/** Whether a box cull \`cull\` of a caster of layer \`layer\` is within map \`pd\`'s dynamic depth range:
 *  only the dynamic layer is cut by it. */
fn vsmCasterInDepthRange(layer:VsmCasterLayer,cull:VsmBoxInView,pd:VsmProjectionData)->bool{
${prefiltered ? PREFILTERED_DEPTH_RANGE_TEXT : ''} return layer.staticLayer||vsmInDynamicDepthRange(cull,pd.dynamicDepthCullRange);
}${prefiltered ? PREFILTERED_MARK_MASK_TEXT : ''}
/** Whether a caster of layer \`layer\` is asked over a receiver of map \`pd\`'s cover: not the static
 *  layer, whose pages may be kept whole. */
fn vsmCasterUsesCover(layer:VsmCasterLayer,pd:VsmProjectionData)->bool{return pd.useCover&&!layer.staticLayer;}
`

/** The caster layer block of a set whose layout says whether it holds the prefiltered distant shadow. */
export const vsmCasterLayerBlock = wgslVariants((prefiltered) =>
  wgslBlock(
    prefiltered ? 'VSM_CASTER_LAYER_PREFILTERED_WGSL' : 'VSM_CASTER_LAYER_WGSL',
    [
      VSM_CONSTANTS_WGSL,
      VSM_PROJECTION_DATA_WGSL,
      VSM_BOX_VIEW_WGSL,
      ...prefilteredDeps(prefiltered),
    ],
    casterLayerText(prefiltered),
  ),
)

/** Where the cull declares the mask its pages are asked by (`markMask`), and what its hidden test takes.
 *  Plain, the layer's, declared with the layer. In a level of a prefiltered distant shadow it is
 *  declared past the box cull, wholly inside the band's inner end asking the primary request of the
 *  pages the view asked alone (`vsmCasterMarkMask`), and the hidden test is the layer's. */
const markMaskOf = wgslVariants((prefiltered) =>
  prefiltered
    ? {
        head: '',
        cull: '\n let markMask=vsmCasterMarkMask(layer,cull,pd);',
        hidden: 'layer.markMask',
      }
    : { head: '\n let markMask=layer.markMask;', cull: '', hidden: 'markMask' },
)

const cullBindingsText = /* wgsl */ `@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> views:array<vec4u>;
@group(1) @binding(2) var<storage,read> candidates:array<VsmRenderCandidate>;
@group(1) @binding(3) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(4) var<storage,read_write> records:array<vec4u>;
/**
 * Whether the raster emits the candidate's triangles in this map with corners 1 and 2 swapped, so
 * that a face toward the light is counter-clockwise as the rasterizer reads it (\`vsmRenderVs\`). A
 * triangle's projected winding is its facing times the sign of D: for a perspective map, D = −det
 * of the UV matrix's u, v, w rows (the light at the shifted origin, those rows linear), for an
 * orthographic one det of its u, v, z rows (z toward the light, reversed Z); the page's NDC y turns
 * it once, and the rasterizer reads the winding in NDC, its framebuffer flip not counted. Swapped
 * where D > 0, against a row whose faces turn (\`VSM_RENDER_CAND_FLIPPED\`); a two-sided row's tiers
 * cull no face, where the swap changes no covered pixel.
 */
fn vsmRenderSwapped(m:mat4x4f,ortho:bool,flags:u32)->bool{
 let r3=select(vec3f(m[0].w,m[1].w,m[2].w),vec3f(m[0].z,m[1].z,m[2].z),ortho);
 let d=dot(vec3f(m[0].x,m[1].x,m[2].x),cross(vec3f(m[0].y,m[1].y,m[2].y),r3));
 let perspectiveSwap=d<0.0;
 let orthoSwap=d>0.0;
 return select(perspectiveSwap,orthoSwap,ortho)!=((flags&VSM_RENDER_CAND_FLIPPED)!=0u);
}
/** Whether a map's mip view draws a candidate at its own level of detail: the engine's cut rule
 *  (\`drawsCompared\`) on its group's error and its parent's, shown or not at the edge scales of their
 *  balls in the view (\`ownScale\`, \`parentScale\`: \`vsmRenderEdgeScale\`, the same for every mip) and the
 *  mip's pixels per unit \`focal\`, held to the shadows' threshold — each shadow view takes the cut it
 *  sees. The verdict: not drawn, drawn at its own
 *  level of detail, or drawn though its error is over the threshold because the finer level is not
 *  resident — a level of detail behind what the view asks. */
fn vsmRenderLodAt(cand:VsmRenderCandidate,ownScale:f32,parentScale:f32,focal:f32)->u32{
 let parentAbove=cand.errors.y<0.0||vsmRenderErrorShows(parentScale,cand.errors.y,focal);
 let ownWithin=!vsmRenderErrorShows(ownScale,cand.errors.x,focal);
 if(!drawsCompared(true,parentAbove,ownWithin,(cand.flags&VSM_RENDER_CAND_CHILD_RESIDENT)!=0u)){return VSM_RENDER_LOD_NOT_DRAWN;}
 return select(VSM_RENDER_LOD_BEHIND,VSM_RENDER_LOD_OWN,ownWithin);
}
/** A place of the list, for a record to draw or one held back: false past its capacity, the place
 *  counted all the same (the frame's peak, \`vsmRenderArgsBin\`). */
fn vsmRenderTake()->bool{return atomicAdd(&counts[VSM_RENDER_COUNT_TAKEN],1u)<params.recordCapacity;}
/** A mip view the first cull holds back: candidate \`k\`, its mip view's place \`viewIndex\` (the
 *  views' pass lists a view a map and a mip), from the end of the list. */
fn vsmRenderHold(k:u32,viewIndex:u32){
 if(!vsmRenderTake()){return;}
 let held=atomicAdd(&counts[VSM_RENDER_COUNT_HELD],1u);
 records[params.recordCapacity-1u-held]=vec4u(k,viewIndex,0u,0u);
}`

/** In the throttled program, a record counts once, for the map and the raster it is drawn by: the
 *  clusters of the performance feedback, in the totals and in the map's entry. */
const cullCountedText = /* wgsl */ `
   if(!counted){
    counted=true;
    let raster=select(VSM_FEEDBACK_HW,VSM_FEEDBACK_SW,bin>=VSM_RENDER_SOFTWARE_BIN);
    atomicAdd(&counts[VSM_RENDER_FEEDBACK+raster],1u);
    atomicAdd(&counts[VSM_RENDER_FEEDBACK+VSM_FEEDBACK_HEADER_WORDS+VSM_FEEDBACK_ENTRY_WORDS*h.id+raster],1u);
   }`

/** The marks every page of a record takes, from the record's own bits (\`word\`, the record's second word). */
const RECORD_MARK_BITS_TEXT = /* wgsl */ `
 let tagged=vec4u(row,word,0u,0u);
 let markBits=vsmRasterMarkBits(vsmRecordStatic(tagged)!=0u,vsmRecordDeforms(tagged),vsmRecordOffsetAllowed(tagged),vsmRecordLodBehind(tagged));`

/** A page the window's flags matched: marked drawn where it is mapped, then left out of the record's rect where it is not a page
 *  to draw at its level. */
const PAGE_MARK_TEXT = /* wgsl */ `
     let entry=vsmTableEntryAtOffset(cell);
     vsmMarkDrawnPage(entry,markBits);
     if(!entry.thisLevelDrawable){continue;}`

const cullSoftwareEmitText = (throttled: boolean, marks: boolean) => /* wgsl */ `
/** Whether a caster is the software raster's in a map's mip view: its longest edge spans no more than \`params.hardwareEdge\` pixels at the nearest point of
 *  its level of detail's sphere — of its whole sphere where its vertices move —, \`scale\` the edge scale
 *  of that sphere in the view (\`vsmRenderEdgeScale\`) and \`focal\` the mip's pixels per unit: the hardware
 *  raster's where \`scale · hardwareEdge < edge · focal\`, multiplied out —, its box crosses neither the near nor the far plane (\`cull\`), and it is neither
 *  tessellated nor a voxel row, which the hardware raster alone draws; none while the software raster
 *  is off (\`hardwareEdge\` 0) or the edge unknown. */
fn vsmRenderSoftware(cand:VsmRenderCandidate,scale:f32,focal:f32,cull:VsmBoxInView,tessellated:bool)->bool{
 if(params.hardwareEdge<=0.0||!(cand.edge>0.0)||tessellated||(cand.corners&VSM_RENDER_VOXEL_BIT)!=0u||cull.pastNear||cull.pastFar){return false;}
 return cand.edge*focal<=scale*params.hardwareEdge;
}
/** The records of a caster's page rect \`pagesRect\` in map \`h\`'s mip \`mipLevel\`, a window of
 *  \`side\` pages a side at a time — \`VSM_RENDER_WINDOW_PAGES\` for the hardware raster,
 *  \`VSM_RENDER_WINDOW_PAGES_SOFTWARE\` for the software raster —: the window clipped to the pages
 *  whose flags hold the caster's stale layer (\`markMask\`)${marks ? ', each marked drawn (\`word\` says how), then to those that are pages to draw' : ''}, and one record a window that holds one,
 *  in the bin \`bin\` and counted with it — none past the list's capacity, counted all the same. */
fn vsmRenderEmit(row:u32,word:u32,bin:u32,h:VsmHandle,mipLevel:u32,pagesRect:vec4u,markMask:u32,side:u32){
 let levelOffset=vsmTableLevelOrigin(h,mipLevel);${marks ? RECORD_MARK_BITS_TEXT : ''}${throttled ? '\n var counted=false;' : ''}
 for(var wy=pagesRect.y;wy<=pagesRect.w;wy+=side){
  for(var wx=pagesRect.x;wx<=pagesRect.z;wx+=side){
   let window=vec2u(wx,wy);
   let end=min(window+vec2u(side-1u),pagesRect.zw);
   var found=false;
   var first=end;
   var last=window;
   for(var y=wy;y<=end.y;y++){
    for(var x=wx;x<=end.x;x++){
     let page=vec2u(x,y);
     let cell=vsmTableEntryAt(levelOffset,mipLevel,page);
     if(!vsmRecordMarksMatch(vsmPageMarkWord(cell),markMask)){continue;}${marks ? PAGE_MARK_TEXT : ''}
     found=true;
     first=min(first,page);
     last=max(last,page);
    }
   }
   if(!found){continue;}
   // A place of the list first, as a record held back takes one: the two never share a place, and
   // every place asked is counted (the frame's peak, \`vsmRenderArgsBin\`).
   if(!vsmRenderTake()){continue;}
   let slot=atomicAdd(&counts[VSM_RENDER_COUNT_RECORDS],1u);
   if(slot>=params.recordCapacity){continue;}
   atomicAdd(&counts[VSM_RENDER_TIER_RECORDS+bin],1u);${throttled ? cullCountedText : ''}
   records[slot]=vec4u(row,word|(bin<<24u),first.x|(first.y<<8u)|(last.x<<16u)|(last.y<<24u),0u);
  }
 }
}`

const cullViewHeadText = (prefiltered: boolean) => /* wgsl */ `
/**
 * One caster (candidate \`k\`) against the mip views of one map of a light that holds it
 * (\`vsmRenderCull\`): \`viewCount\` views from \`firstView\` in \`views\`, all of one map (the views' pass
 * lists a map's mip views one after the other, \`vsmRenderViews\`). The map's layer and its frustum
 * once, then for each mip its level of detail, its page rect and its records — with the occlusion's
 * first cull (\`kind\`), held back where the previous frame's pyramid hides it; its second culls one
 * view, its level of detail as the first chose it, and leaves out what this frame's pyramid hides.
 */
fn vsmRenderCullViews(cand:VsmRenderCandidate,k:u32,firstView:u32,viewCount:u32,mapLayers:u32,kind:u32){
 let mapId=views[firstView].x;
 let h=vsmHandleFromId(mapId);
 let pd=vsmProjectionOf(h);
 let directional=pd.lightKind==LIGHT_KIND_DIRECTIONAL;
 let nearClip=!directional;
 let viewToClip=pd.lightViewToClip;
 let isOrtho=viewToClip[3][3]>=1.0;
 let shiftedToClip=vsmShiftedToClip(pd.shiftedToMapUv);
 let center=vsmShiftedCentre(cand.c.xyz,cand.l,pd);
 // The static layer takes a caster that stands still (the engine's mobility) in a cached map; a
 // moving one draws into the dynamic layer: its mobility decides it, frame by frame.
 // A caster cached as dynamic in this view (its placement's per-view bit) draws as one that moves, as
 // does every cluster of a placement whose offset this map allows and whose object lets it invalidate.
 let offsetAlways=(cand.flags&VSM_RENDER_CAND_OFFSET_ALWAYS)!=0u;
 let offsetKept=(cand.flags&VSM_RENDER_CAND_OFFSET_KEEPS)!=0u;
 let offsetEvaluated=(cand.flags&VSM_RENDER_CAND_OFFSET)!=0u;
 // Whether the offset is allowed in this map: always, else the object evaluates it and the map's
 // level is not past the distance the object stops at.
 let offsetAllowed=offsetAlways||vsmOffsetGrows(offsetEvaluated,false,cand.offsetDisableSq,pd.wpoThreshold);
 let placementAllowed=vsmOffsetGrows((cand.flags&VSM_RENDER_CAND_PLACEMENT_OFFSET)!=0u,(cand.flags&VSM_RENDER_CAND_PLACEMENT_ALWAYS)!=0u,cand.offsetDisableSq,pd.wpoThreshold);
 let layer=vsmCasterLayer(placementAllowed||(cand.flags&(VSM_RENDER_CAND_DYNAMIC|VSM_RENDER_CAND_DEFORMING))!=0u,cand.viewBits,pd);
 let staticLayer=layer.staticLayer;
 // One that changed its cache state this frame redraws every page it overlaps, the stale ones of both layers.
 let transitioned=layer.transitioned;
 // The receiver cover and the mark mask depend on the cache state.
 let useCover=vsmCasterUsesCover(layer,pd);${markMaskOf(prefiltered).head}
 let layerBit=select(1u,2u,staticLayer);
 // A map none of whose views has a page to draw in the caster's layer is left out, but for a caster that
 // changed its cache state: it redraws the stale pages of both layers.
 if((mapLayers&layerBit)==0u&&!transitioned){return;}`

/** The bit of the record's word that says the window's pages were matched by the primary request mark
 *  too (`vsmRecordMarkPrimary`): a caster in the inner band of a prefiltered level; none otherwise. */
const markPrimaryText = (prefiltered: boolean) =>
  prefiltered ? '|select(0u,1u<<31u,(markMask&VSM_PAGE_PRIMARY)!=0u)' : ''

const cullViewFrustumText = (prefiltered: boolean) => /* wgsl */ `
 // Frustum cull of the caster's own box; non-static geometry also within the map's dynamic depth range (\`dynamicDepthCullRange\`).
 // The box holds the reach of the placement's offset only where this map grows the bounds by it (\`vsmOffsetGrows\`).
 let fit=select(vsmCandFit(cand),vec3f(1.0),placementAllowed);
 let cull=vsmCasterBoxInView(center,cand.a0*fit.x,cand.a1*fit.y,cand.a2*fit.z,shiftedToClip,viewToClip,isOrtho,nearClip);
 if(!cull.inMapView||!vsmCasterInDepthRange(layer,cull,pd)){return;}${markMaskOf(prefiltered).cull}
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
 let word=mapId|select(0u,1u<<20u,directional)|select(0u,1u<<21u,staticLayer)
  |select(0u,1u<<22u,vsmRenderSwapped(pd.shiftedToMapUv,isOrtho,cand.flags))
  |select(0u,1u<<23u,tessellated)|select(0u,1u<<28u,invalidates)|select(0u,1u<<29u,offsetMarked)
  |select(0u,1u<<19u,transitioned)${markPrimaryText(prefiltered)};
 // The lens: the near plane and the kind of view, the map's own; each mip view carries its level of
 // detail's scale (\`focal\`, pixels a unit at depth one).
 let lens=vsmViewLens(viewToClip,pd.finestMip);
 // The edge scales of the balls the level of detail and the raster choice measure, once for all the
 // mips and at the first that reaches them (a mip with no page to draw asks none). The raster's is the
 // level of detail's ball, the whole sphere where the vertices move; the parent's is the level of
 // detail's alone.
 var scaled=false;
 var ownScale=0.0;
 var rasterScale=0.0;
 var parentScaled=false;
 var parentScale=0.0;
 // The object is judged whole, not by the cluster: it stays out of the coarse pages by its own ball's
 // footprint, the same for all its clusters; the cluster then takes every page its rect overlaps.
 let objectCentre=center+cand.inst.xyz;
 let objectExtent=vec3f(cand.inst.w);
 let objectPoint=vsmBoxCullPoint(objectCentre,objectExtent,isOrtho,nearClip);
 let objectCull=vsmBoxInView(shiftedToClip*vec4f(objectPoint,1.0),shiftedToClip[0],shiftedToClip[1],shiftedToClip[2],objectExtent,viewToClip,isOrtho,nearClip);
 // One radius for the object, the map's full resolution whatever the mip drawn (the instance cull's).
 let fineObject=vsmIsFineCaster(staticLayer,vsmClipRadius(isOrtho,cand.inst.w,objectCentre,viewToClip)*f32(VSM_LEVEL0_TEXELS));`

const cullViewMipText = (prefiltered: boolean) => /* wgsl */ `
 // The second cull keeps the level of detail the first chose.
 let second=kind==VSM_RENDER_CULL_SECOND;
 // The previous image drew the caster's box under the placement's previous pose (\`prevShift\`, the half
 // axes of \`vsmCandPrevAxes\`), the map's reach grown the same; projected under the map's previous view
 // once for all the mips, at the first that tests it.
 var prevProjected=false;
 var prevCull:VsmBoxInView;
 for(var i=0u;i<viewCount;i++){
  let view=views[firstView+i];
  // A mip with no stale page of the caster's layer draws nothing of it, but for a caster that changed
  // its cache state: it redraws the stale pages of both layers.
  if((view.z&layerBit)==0u&&!transitioned){continue;}
  let mipLevel=view.y;
  let focal=bitcast<f32>(view.w);
  let levelTexels=i32(VSM_LEVEL0_TEXELS>>mipLevel);
  let pixels=vsmStalePixels(cull,h,mipLevel,staticLayer,transitioned);
  // The object first, by the pages it overlaps (the fine ones alone for a fine object), then the cluster.
  // Before the level of detail: a mip with no page to draw asks none.
  let objectRect=vsmStalePixels(objectCull,h,mipLevel,staticLayer,transitioned);
  if(!vsmTouchesMappedPixels(h,mipLevel,objectRect,markMask,fineObject,useCover)){continue;}
  if(!vsmTouchesMappedPixels(h,mipLevel,pixels,markMask,false,useCover)){continue;}
  if(!scaled){
   ownScale=vsmRenderEdgeScale(center+cand.own.xyz,cand.own.w,shiftedToClip,viewToClip,lens);
   rasterScale=ownScale;
   if((cand.flags&VSM_RENDER_CAND_MOVING)!=0u){rasterScale=vsmRenderEdgeScale(center,cand.c.w,shiftedToClip,viewToClip,lens);}
   scaled=true;
  }
  // The second cull keeps the level of detail the first chose; the verdict is asked of it only to
  // tell a level behind.
  var lod=VSM_RENDER_LOD_OWN;
  if(!second||vsm.lodDeltaInvalidates!=0u){
   if(!parentScaled){
    if(cand.errors.y>=0.0){parentScale=vsmRenderEdgeScale(center+cand.parent.xyz,cand.parent.w,shiftedToClip,viewToClip,lens);}
    parentScaled=true;
   }
   lod=vsmRenderLodAt(cand,ownScale,parentScale,focal);
  }
  if(!second&&lod==VSM_RENDER_LOD_NOT_DRAWN){continue;}
  // A cluster drawn behind marks the pages it is drawn into, to be invalidated when the finer level is resident.
  let lodBehind=vsm.lodDeltaInvalidates!=0u&&lod==VSM_RENDER_LOD_BEHIND;
  if(kind==VSM_RENDER_CULL_FIRST&&vsmPrevViewHolds(pd,mipLevel)){
   if(!prevProjected){
    let prevAxes=vsmCandPrevAxes(cand);
    prevCull=vsmPrevBoxInView(pd,center+cand.prevShift,prevAxes[0]*fit.x,prevAxes[1]*fit.y,prevAxes[2]*fit.z,nearClip);
    prevProjected=true;
   }
   if(vsmHiddenBefore(pd,prevCull,mipLevel,levelTexels,staticLayer)){
    vsmRenderHold(k,firstView+i);
    continue;
   }
  }
  if(kind>=VSM_RENDER_CULL_SECOND&&vsmHiddenNow(h,mipLevel,cull,levelTexels,pixels,${markMaskOf(prefiltered).hidden},staticLayer)){continue;}
  // The hardware raster's tier, or the software raster's bin of the caster's layer and its window.
  let software=vsmRenderSoftware(cand,rasterScale,focal,cull,tessellated);
  let bin=select(tier,VSM_RENDER_SOFTWARE_BIN+select(0u,1u,staticLayer),software);
  vsmRenderEmit(cand.row,word|(mipLevel<<16u)|select(0u,1u<<30u,lodBehind),bin,h,mipLevel,vec4u(pixels)>>vec4u(VSM_LOG2_PAGE),markMask,select(VSM_RENDER_WINDOW_PAGES,VSM_RENDER_WINDOW_PAGES_SOFTWARE,software));
 }
}`

const cullCandidateText = /* wgsl */ `
/** A caster against the listed mip views of one map of its light (the first cull's, the post cull's or the cull
 *  with no test); the post cull's casters are those found since the descent's post pass opened. */
fn vsmRenderCullCandidate(wid:vec3u,nwg:vec3u,lane:u32,kind:u32){
 let first=select(0u,atomicLoad(&counts[VSM_RENDER_COUNT_CAST_FIRST]),kind==VSM_RENDER_CULL_POST);
 let k=first+flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(k>=atomicLoad(&counts[0])||wid.z>=min(atomicLoad(&counts[VSM_RENDER_COUNT_VIEWS]),params.viewCount)){return;}
 let cand=candidates[k];
 let listing=views[wid.z];
 // A caster that shares no lighting channel with the light casts none into its maps.
 if(!vsmCandSharesChannel(cand.flags,listing.w)){return;}
 let pd=vsmProjectionOf(vsmHandleFromId(listing.z));
 let directional=pd.lightKind==LIGHT_KIND_DIRECTIONAL;
 // The objects that stand for a first-person one are drawn into the suns' first-person clipmaps and into
 // no other map, which hold every other object but them.
 if(((cand.flags&VSM_RENDER_CAND_WORLD_SPACE)!=0u)!=pd.firstPerson){return;}
 // Local views enable distance cull and near clip.
 let center=vsmShiftedCentre(cand.c.xyz,cand.l,pd);
 // Range-based culling distance = the light's radius: its culling volume, the same for all its maps
 // (they share the light's origin and range) and tested for each map's thread, on the caster's box.
 if(!directional&&vsmCasterPastRange(center,cand.a0,cand.a1,cand.a2,pd.lightRange)){return;}
 vsmRenderCullViews(cand,k,params.viewCount+listing.x,listing.y,listing.w&VSM_RENDER_VIEW_LAYERS_MASK,kind);
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
 *  then its view and mip (\`vsmRenderCullViews\`). */
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderCullSecond(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let i=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(i>=atomicLoad(&counts[VSM_RENDER_COUNT_HELD])){return;}
 let held=records[params.recordCapacity-1u-i];
 let cand=candidates[held.x];
 let pd=vsmProjectionOf(vsmHandleFromId(views[held.y].x));
 let directional=pd.lightKind==LIGHT_KIND_DIRECTIONAL;
 let center=vsmShiftedCentre(cand.c.xyz,cand.l,pd);
 if(!directional&&vsmCasterPastRange(center,cand.a0,cand.a1,cand.a2,pd.lightRange)){return;}
 vsmRenderCullViews(cand,held.x,held.y,1u,views[held.y].z,VSM_RENDER_CULL_SECOND);
}`

/**
 * `vsmRenderCull` and `vsmRenderCullFirst`: group 0 = `vsmRenderCullSpecs(marks)`; group 1: 0 params
 * (uniform, dynamic), 1 views (vec4u: the listed maps' groups — run start, run length, map id, the
 * stale layers of its views together and the light's channels —, then, from `params.viewCount`, their runs of mip views — map id, mip, stale
 * layers, level of detail's scale —, `vsmRenderViews`), 2 candidates, 3 counters (rw atomic), 4
 * records (rw). Dispatch: x and y over the candidates (64 each), z = listed map (group) index.
 * `vsmRenderCullSecond`: a thread a record held back (x and y). `vsmRenderCullPost`: over the candidates from
 * `VSM_RENDER_COUNT_CAST_FIRST`. The occlusion's three read group 2 (`VSM_OCCLUSION_GROUP`): the
 * pyramid and the kept tables — the previous frame's in the first, this frame's in the second and
 * the post cull.
 *
 * Record (vec4u, `VSM_RENDER_RECORD_WGSL`): x row; y VSM id | mip << 16 | marks wanted << 19 | no
 * near clip << 20 | static << 21 | swapped << 22 (`vsmRenderSwapped`) | tessellated << 23 | bin << 24 |
 * deforms << 28 | marks primary << 31 (the marks the window's pages were matched by);
 * z the window's first page x | y << 8 and its last page x << 16 | y << 24 (pages of the mip,
 * inclusive); w none (the bin puts the page table there).
 * A record held back, from the list's end: x the candidate, y its mip view's place in `views`.
 *
 * `marks`: the cull marks the pages it emits drawn (`vsmCullMarks`).
 *
 * `throttled` (the compute throttle is on this frame, `../throttle.ts`): the program also counts, in
 * the counters past the frame's own, the clusters it draws in each map (`cullCountedText`); the
 * program without it is the one every frame ran before the throttle.
 *
 * With the prefiltered distant shadow in the layout (`VsmLayout.prefilteredDistant`) the program also
 * cuts a caster in a level of a clipmap that holds one by the level's band, asks the primary
 * request of the pages a caster wholly inside the band's inner end is drawn into
 * (`vsmCasterMarkMask`), and tests each page's marks against all the request bits the mask holds
 * (`vsmMarksMatch`); the program of a layout without it is the one that ran before.
 */
export const vsmRenderCullWgsl = (layout: VsmLayout, throttled = false, marks = false) =>
  wgslProgram(
    /* wgsl */ `
${cullBindingsText}${cullSoftwareEmitText(throttled, marks)}${cullViewHeadText(layout.prefilteredDistant)}${cullViewFrustumText(layout.prefilteredDistant)}${cullViewMipText(layout.prefilteredDistant)}${cullCandidateText}
`,
    [
      ...(throttled ? [VSM_FEEDBACK_WGSL] : []),
      vsmRenderOverlapBlock(layout.prefilteredDistant),
      VSM_OCCLUSION_TEST_WGSL,
      vsmCasterLayerBlock(layout.prefilteredDistant),
      VSM_OFFSET_GROWS_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      vsmBindingsWgsl(0, vsmRenderCullSpecs(marks), layout),
      ...(marks ? [VSM_PAGE_LOOKUP_WGSL, VSM_RASTER_MARKS_WGSL, VSM_RENDER_RECORD_WGSL] : []),
      VSM_PROJECTION_DATA_READ_WGSL,
      VSM_PAGE_MARKS_GATHER_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      vsmBoxCullBlock(layout.prefilteredDistant),
      VSM_CASTER_BOX_CULL_WGSL,
      VSM_RENDER_EDGE_SCALE_WGSL,
      CUT_RULE_WGSL,
      LIGHTING_CHANNELS_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
