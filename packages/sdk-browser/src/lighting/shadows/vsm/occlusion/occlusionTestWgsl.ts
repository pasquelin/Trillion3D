/**
 * THE OCCLUSION TEST OF A CASTER IN A MAP'S MIP (`../render/renderCullWgsl.ts`): its screen rect
 * tested, page by page, against the pyramid of the pool through a frame's kept tables
 * (`occlusionResources.ts`) — the previous frame's in the first cull, this frame's in the second.
 *
 * - `vsmScreenRect`: the rect's pixels, and its texels in the pyramid —
 *   level 0 half the map's mip, then the level where the rect spans 4 texels at most
 *   (`vsmLevelHoldingRect`) —, and its depth, the box's nearest (reversed Z: its greatest).
 * - `vsmPagesVisible`: the rect held at the level where a
 *   page is 4x4 texels, its pages clipped to the map's stale rect, then each page whose marks hold
 *   `testMask` and that the table maps at this mip read in the pyramid at its physical page — the
 *   rect clamped to the page —: visible when the rect's depth is not farther than the least of its
 *   4x4 texels. A page the table does not map at this mip hides the
 *   caster: unmapped pages count as occluded.
 * - `vsmPrevViewHolds`, `vsmPrevBoxInView`, `vsmHiddenBefore`, the first cull: the box, under the
 *   placement's previous pose, projected once under the map's previous view (its sides untested), then
 *   tested in each mip and layer where it lies within its depth and short of its near plane against
 *   the previous frame's pyramid, through the map's previous id and table, every marked page tested;
 *   a map with no previous view for a mip hides nothing there.
 * - `vsmHiddenNow`, the second: the box's rect this frame, its
 *   pages clipped as the cull clipped them, short of the near plane, against this frame's pyramid
 *   and tables, the pages of the caster's stale layer tested.
 *
 * Group 2 of the cull: 0 the pyramid (every level, by load), 1 the kept page table, 2 the kept
 * marks (level 0), 3 the kept stale rects (`VSM_KEPT_RECTS_WIDTH` a row) — sampled textures, read by
 * load: the cull's eight storage buffers are spent.
 */
import { wgslBlock, type WgslDecl } from '../../../../../../math/src/wgsl/decl.ts'
import { VSM_BOX_VIEW_WGSL, VSM_CASTER_BOX_CULL_WGSL } from '../invalidation/boxCullWgsl.ts'
import {
  VSM_CONSTANTS_WGSL,
  VSM_KEPT_RECTS_WIDTH,
  VSM_STALE_RECT_INDEX_WGSL,
} from '../constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL } from '../pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../projection/projectionDataWgsl.ts'

/** The cull's occlusion group. */
const VSM_OCCLUSION_GROUP = 2

/**
 * The pyramid read at one page's place (`vsmPageVisibleHzb`) and the group it reads through
 * (`VSM_OCCLUSION_GROUP`): what the cull's tests (`VSM_OCCLUSION_TEST_WGSL`) and the cache
 * invalidation's (`../invalidation/castInvalidationWgsl.ts`) share.
 */
const pagesDeclarations = [
  VSM_CONSTANTS_WGSL,
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
  VSM_STALE_RECT_INDEX_WGSL,
  VSM_BOX_VIEW_WGSL,
]
const pagesOfGroup = new Map<number, WgslDecl>()
/** The pyramid read at one page's place, over the occlusion group bound at group `group`: the cull's own (`VSM_OCCLUSION_GROUP`) or, for a
 *  program that already holds that group, another (the patches' tessellation, `tessellation/shadowSightWgsl.ts`). */
function vsmOcclusionPagesWgsl(group: number) {
  let block = pagesOfGroup.get(group)
  if (!block)
    pagesOfGroup.set(
      group,
      (block = wgslBlock(
        group === VSM_OCCLUSION_GROUP
          ? 'VSM_OCCLUSION_PAGES_WGSL'
          : `VSM_OCCLUSION_PAGES_WGSL_${group}`,
        pagesDeclarations,
        /* wgsl */ `
@group(${group}) @binding(0) var occlusionPyramid:texture_2d_array<f32>;
@group(${group}) @binding(1) var occlusionTable:texture_2d<u32>;
@group(${group}) @binding(2) var occlusionMarks:texture_2d<u32>;
@group(${group}) @binding(3) var occlusionRects:texture_2d<u32>;
/** A box's rect on a map's mip: its pixels (inclusive), its texels at pyramid level \`level\`, its
 *  depth. */
struct VsmScreenRect{pixels:vec4i,texels:vec4i,level:i32,depth:f32,}
fn vsmScreenRect(viewRect:vec4i,cull:VsmBoxInView)->VsmScreenRect{
 var r:VsmScreenRect;
 r.depth=cull.clipHigh.z;
 r.pixels=vsmRectPixels(viewRect,cull);
 // Pyramid level 0 is half the mip: a texel covers 2x2 pixels.
 r.texels=vec4i(r.pixels.xy,max(r.pixels.xy,r.pixels.zw))>>vec4u(1u);
 r.level=vsmLevelHoldingRect(r.texels,4);
 r.texels=r.texels>>vec4u(u32(r.level));
 return r;
}
/** Whether a rect of 4x4 texels at most, at pyramid level \`level\`, is not farther than \`depth\`
 *  anywhere: its depth at least the least of them. */
fn vsmPyramidVisible(texels:vec4i,level:i32,depth:f32,layer:u32)->bool{
 var least=1.0;
 for(var j=0;j<4;j++){
  for(var i=0;i<4;i++){
   let at=min(texels.xy+vec2i(i,j),texels.zw);
   least=min(least,textureLoad(occlusionPyramid,at,layer,level).x);
  }
 }
 return depth>=least;
}
/** The rect held at the level where a page is 4x4 texels: past it, the texels from the pixels. */
fn vsmPageLevelRect(rect:VsmScreenRect)->VsmScreenRect{
 var r=rect;
 if(r.level>i32(VSM_LOG2_PAGE)-3){
  r.texels=vec4i(r.pixels.xy,max(r.pixels.xy,r.pixels.zw))>>vec4u(VSM_LOG2_PAGE-2u);
  r.level=i32(VSM_LOG2_PAGE)-3;
 }
 return r;
}
/** Whether a rect (held at its page level, \`vsmPageLevelRect\`) is visible on page (\`x\`, \`y\`) of map
 *  \`h\`'s mip, in the pyramid at the page's physical place — the rect clamped to the page —; a page the
 *  table does not map at this mip is visible unless \`unmappedOccluded\`. */
fn vsmPageVisibleHzb(h:VsmHandle,mipLevel:u32,r:VsmScreenRect,x:u32,y:u32,unmappedOccluded:bool,staticLayer:bool)->bool{
 let cell=vsmTableEntryAt(vsmTableLevelOrigin(h,mipLevel),mipLevel,vec2u(x,y));
 let entry=vsmUnpackTableEntry(textureLoad(occlusionTable,cell.tableXY,0).x);
 if(!entry.thisLevelMapped){return !unmappedOccluded;}
 let pageShift=VSM_LOG2_PAGE-1u-u32(r.level);
 let pageLast=i32((1u<<pageShift)-1u);
 // The rect in the page, clamped to it, then at its physical page.
 let pageOrigin=vec2i(vec2u(x,y)<<vec2u(pageShift));
 var t=clamp(r.texels-pageOrigin.xyxy,vec4i(0),vec4i(pageLast));
 t+=vec2i(entry.physicalAddress<<vec2u(pageShift)).xyxy;
 return vsmPyramidVisible(t,r.level,r.depth,select(0u,vsm.hzbStaticLayer,staticLayer));
}
`,
      )),
    )
  return block
}
export const VSM_OCCLUSION_PAGES_WGSL = vsmOcclusionPagesWgsl(VSM_OCCLUSION_GROUP)

const hiddenOfGroup = new Map<number, WgslDecl>()
/** The tests of a box against the pyramid that need no stale rect: the first cull's (`vsmHiddenBefore`) and the second's (`vsmHiddenNow`), over the
 *  occlusion group at `group` (`vsmOcclusionPagesWgsl`). */
export function vsmOcclusionHiddenWgsl(group: number) {
  let block = hiddenOfGroup.get(group)
  if (!block)
    hiddenOfGroup.set(
      group,
      (block = wgslBlock(
        group === VSM_OCCLUSION_GROUP
          ? 'VSM_OCCLUSION_HIDDEN_WGSL'
          : `VSM_OCCLUSION_HIDDEN_WGSL_${group}`,
        [vsmOcclusionPagesWgsl(group), VSM_PROJECTION_DATA_WGSL, VSM_CASTER_BOX_CULL_WGSL],
        /* wgsl */ `
/** The kept stale rect of a (map, mip, layer). */
fn vsmKeptRect(id:u32,mipLevel:u32,staticLayer:bool)->vec4u{
 let index=vsmStaleRectIndex(id,mipLevel,staticLayer);
 return textureLoad(occlusionRects,vec2u(index%${VSM_KEPT_RECTS_WIDTH}u,index/${VSM_KEPT_RECTS_WIDTH}u),0);
}
/** The marks every page holds some of: a test on every mapped page. */
const VSM_ANY_PAGE_MARKS:u32=0xffffffffu;
/** Whether a rect of map \`h\`'s mip is visible on one of its pages whose marks hold \`testMask\`, in
 *  the pyramid, through the kept tables bound. */
fn vsmPagesVisible(h:VsmHandle,mipLevel:u32,rect:VsmScreenRect,testMask:u32,staticLayer:bool)->bool{
 if(!vsmHandleIsValid(h)){return true;}
 let r=vsmPageLevelRect(rect);
 let bounds=vsmKeptRect(h.id,mipLevel,staticLayer);
 let unclipped=vec4u(r.pixels)>>vec4u(VSM_LOG2_PAGE);
 let pages=vec4u(max(unclipped.xy,bounds.xy),min(unclipped.zw,bounds.zw));
 let levelOrigin=vsmTableLevelOrigin(h,mipLevel);
 for(var y=pages.y;y<=pages.w;y++){
  for(var x=pages.x;x<=pages.z;x++){
   let cell=vsmTableEntryAt(levelOrigin,mipLevel,vec2u(x,y));
   if((textureLoad(occlusionMarks,cell.tableXY,0).x&testMask)==0u){continue;}
   if(vsmPageVisibleHzb(h,mipLevel,r,x,y,true,staticLayer)){return true;}
  }
 }
 return false;
}
/** Whether a map has a previous view to test mip \`mipLevel\` against: its previous table (a mip finer
 *  than the previous map's finest has no level in it) and its previous view. */
fn vsmPrevViewHolds(pd:VsmProjectionData,mipLevel:u32)->bool{
 return vsmHandleIsValid(VsmHandle(pd.prevMapId,pd.prevTableOrigin,pd.prevFinestMip))&&mipLevel>=pd.prevFinestMip;
}
/** The box (\`center\`, \`a0\` to \`a2\`, in this frame's shifted space, the centre and the half axes
 *  where the previous image drew it) under the map's previous view, its sides untested: projected
 *  once, whatever the mip and the layer it is tested in (\`vsmHiddenBefore\`). */
fn vsmPrevBoxInView(pd:VsmProjectionData,center:vec3f,a0:vec3f,a1:vec3f,a2:vec3f,nearClip:bool)->VsmBoxInView{
 var viewToClip=mat4x4f();
 viewToClip[2][2]=pd.prevClipDepth.x;
 viewToClip[3][2]=pd.prevClipDepth.y;
 viewToClip[3][3]=pd.prevClipDepth.z;
 return vsmCasterBoxInView(center,a0,a1,a2,pd.prevShiftedToClip,viewToClip,pd.prevClipDepth.z>=1.0,nearClip);
}
/** Whether the first cull holds a caster back: its box under the previous view (\`cull\`, \`vsmPrevBoxInView\`),
 *  of a map that has one for the mip (\`vsmPrevViewHolds\`), hidden in mip \`mipLevel\` (\`levelTexels\` a
 *  side) as the previous frame's pyramid holds it. */
fn vsmHiddenBefore(pd:VsmProjectionData,cull:VsmBoxInView,mipLevel:u32,levelTexels:i32,staticLayer:bool)->bool{
 if(!cull.inDepth||cull.pastNear){return false;}
 let rect=vsmScreenRect(vec4i(0,0,levelTexels,levelTexels),cull);
 return !vsmPagesVisible(VsmHandle(pd.prevMapId,pd.prevTableOrigin,pd.prevFinestMip),mipLevel,rect,VSM_ANY_PAGE_MARKS,staticLayer);
}
/** Whether the second cull leaves a caster out: its box's \`cull\` in mip \`mipLevel\` of map \`h\`,
 *  its pixels clipped to its stale rect (\`clipped\`), hidden in this frame's pyramid on every page of
 *  its stale layer (\`markMask\`). */
fn vsmHiddenNow(h:VsmHandle,mipLevel:u32,cull:VsmBoxInView,levelTexels:i32,clipped:vec4i,markMask:u32,staticLayer:bool)->bool{
 if(cull.pastNear){return false;}
 var rect=vsmScreenRect(vec4i(0,0,levelTexels,levelTexels),cull);
 rect.pixels=clipped;
 return !vsmPagesVisible(h,mipLevel,rect,markMask,staticLayer);
}
`,
      )),
    )
  return block
}

export const VSM_OCCLUSION_TEST_WGSL = wgslBlock(
  'VSM_OCCLUSION_TEST_WGSL',
  [vsmOcclusionHiddenWgsl(VSM_OCCLUSION_GROUP), VSM_PROJECTION_DATA_WGSL, VSM_CASTER_BOX_CULL_WGSL],
  /* wgsl */ `

/** Clips a pixel rect to the uncached page rect bounds of a map's mip, its static or dynamic
 *  layer's (\`vsmStaleRects\`, which the module's host declares); \`both\`: to the union of the two. */
fn vsmClipToStaleRect(pixels:vec4i,h:VsmHandle,mipLevel:u32,staticLayer:bool,both:bool)->vec4i{
 var rect=vsmStaleRects[vsmStaleRectIndex(h.id,mipLevel,staticLayer)];
 if(both){
  let other=vsmStaleRects[vsmStaleRectIndex(h.id,mipLevel,!staticLayer)];
  rect=vec4u(min(rect.xy,other.xy),max(rect.zw,other.zw));
 }
 let bounds=vec4i(vec4u(rect.xy<<vec2u(VSM_LOG2_PAGE),(rect.zw<<vec2u(VSM_LOG2_PAGE))+vec2u(VSM_PAGE_TEXELS-1u)));
 return vec4i(max(pixels.xy,bounds.xy),min(pixels.zw,bounds.zw));
}
/** The pixels box cull \`cull\` covers of map \`h\`'s mip \`mip\` (\`vsmRectPixels\`), clipped to a layer's stale rect
 *  (\`vsmClipToStaleRect\`). */
fn vsmStalePixels(cull:VsmBoxInView,h:VsmHandle,mipLevel:u32,staticLayer:bool,both:bool)->vec4i{
 let texels=i32(VSM_LEVEL0_TEXELS>>mipLevel);
 return vsmClipToStaleRect(vsmRectPixels(vec4i(0,0,texels,texels),cull),h,mipLevel,staticLayer,both);
}
`,
)
