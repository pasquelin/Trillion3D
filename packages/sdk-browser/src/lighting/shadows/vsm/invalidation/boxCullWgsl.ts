import { VSM_PAGE_MARKS_GATHER_WGSL } from '../pageGatherWgsl.ts'
import { wgslBlock, wgslFn, wgslVariants } from '../../../../../../math/src/wgsl/decl.ts'
import { FLOAT32_MAX } from '../../../../../../math/src/wgsl/constants.ts'
import { perspectiveDivide } from '../../../../../../math/src/wgsl/projection.ts'
import { floorLog2 } from '../../../../../../math/src/wgsl/integer.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL } from '../pageTableWgsl.ts'
import { prefilteredDeps } from '../prefilteredWgsl.ts'
/** Whether a map allows an offset that `applies` (the offset's own conditions: a placement's may
 *  invalidate its shadows; a surface wears one its placement evaluates): it is evaluated `always`,
 *  whatever the distance says, or the map's level (`wpoThreshold`) is not past the square of the
 *  distance the object stops at (`disableSq`, 0 for never). The map then grows the bounds of the
 *  placement by the offset's reach and caches the placement as dynamic there: the cull's
 *  (`vsmRenderCullViews`), the shadow views' descent's and the invalidation's
 *  (`vsmOffsetAllowed`). */
export const VSM_OFFSET_GROWS_WGSL = wgslFn(
  'vsmOffsetGrows',
  [],
  `fn vsmOffsetGrows(applies:bool,always:bool,disableSq:f32,wpoThreshold:f32)->bool{
 return applies&&(always||disableSq<=0.0||wpoThreshold<=disableSq);
}`,
)

/** A map's lens at mip `mip`: the pixels a unit spans at depth one (an orthographic view's a
 *  unit), its near plane (none for an orthographic view) and whether it is a perspective view — the
 *  `lens` of `vsmRenderEdgeScales`. The cull's, the shadow views'
 *  descent's and the patches' (`../tessellation/shadowViewWgsl.ts`). */
export const VSM_VIEW_LENS_WGSL = wgslBlock(
  'VSM_VIEW_LENS_WGSL',
  [VSM_CONSTANTS_WGSL],
  `struct VsmViewLens{focal:f32,near:f32,perspective:bool,}
fn vsmViewLens(viewToClip:mat4x4f,mip:u32)->VsmViewLens{
 let isOrtho=viewToClip[3][3]>=1.0;
 return VsmViewLens(0.5*abs(viewToClip[1][1])*f32(VSM_LEVEL0_TEXELS>>mip),select(viewToClip[3][2]/(1.0-viewToClip[2][2]),0.0,isOrtho),!isOrtho);
}
`,
)

/**
 * The frustum cull of a box given in clip space, the pixels it covers and the mip level covering a
 * rect, which read no page table nor mark: the part of `VSM_BOX_CULL_WGSL` that the patches of a
 * displaced surface in a shadow map are judged by too (`../tessellation/shadowViewWgsl.ts`) and the
 * occlusion's test (`../occlusion/occlusionTestWgsl.ts`).
 */
export const VSM_BOX_VIEW_WGSL = wgslBlock(
  'VSM_BOX_VIEW_WGSL',
  [FLOAT32_MAX, perspectiveDivide, floorLog2],
  `
/** \`inDepth\`: the box within the view's depth range, its sides untested — what the occlusion's
 *  first cull reads of the previous view; \`inMapView\` the sides
 *  tested too. */
struct VsmBoxInView{clipLow:vec3f,clipHigh:vec3f,pastFar:bool,pastNear:bool,inMapView:bool,inDepth:bool,}
/** Whether the box's clip depths reach into a map's dynamic depth range \`range\` (near, far): the
 *  test non-static geometry takes after the frustum's (\`vsmCasterInDepthRange\`, which the cull of a
 *  cluster and the shadow views' descent on a node's box both ask). */
fn vsmInDynamicDepthRange(cull:VsmBoxInView,range:vec2f)->bool{
 return cull.clipHigh.z>range.x&&cull.clipLow.z<range.y;
}
/** The frustum cull of a box under an orthographic view, from its centre and its half axes (its
 *  extent along each local axis) in clip space. */
fn vsmBoxInOrthoView(clipCentre:vec3f,axisX:vec3f,axisY:vec3f,axisZ:vec3f,nearClip:bool)->VsmBoxInView{
 var cull:VsmBoxInView;
 let clipExtent=abs(axisX)+abs(axisY)+abs(axisZ);
 cull.clipLow=clipCentre-clipExtent;
 cull.clipHigh=clipCentre+clipExtent;
 cull.pastFar=cull.clipLow.z<0.0;
 cull.pastNear=cull.clipHigh.z>1.0;
 cull.inMapView=cull.clipHigh.z>0.0;
 if(nearClip){cull.inMapView=cull.inMapView&&cull.clipLow.z<1.0;}
 cull.inDepth=cull.inMapView;
 let offView=any(cull.clipHigh.xy<vec2f(-1.0))||any(cull.clipLow.xy>vec2f(1.0));
 cull.inMapView=cull.inMapView&&!offView;
 return cull;
}
/** The frustum cull of a box under a perspective view, from its corner (its centre less its
 *  extent) and its edges (twice its extent along each local axis) in clip space. */
fn vsmBoxInPerspectiveView(corner000:vec4f,dx:vec4f,dy:vec4f,dz:vec4f,viewToClip:mat4x4f)->VsmBoxInView{
 var cull:VsmBoxInView;
 var wLow=FLOAT32_MAX;var wHigh=-FLOAT32_MAX;
 var sideLow=vec4f(1.0);
 cull.clipLow=vec3f(1.0);cull.clipHigh=vec3f(-1.0);
 let corner100=corner000+dz;let corner001=corner000+dx;let corner101=corner100+dx;
 let corner011=corner001+dy;let corner111=corner101+dy;let corner010=corner011-dx;let corner110=corner111-dx;
 var boxCorners=array<vec4f,8>(corner000,corner100,corner001,corner101,corner011,corner111,corner010,corner110);
 for(var k=0u;k<8u;k++){
  let p=boxCorners[k];
  wLow=min(wLow,p.w);wHigh=max(wHigh,p.w);
  sideLow=min(sideLow,vec4f(p.xy,-p.xy)-p.w);
  let ps=perspectiveDivide(p).xy;
  cull.clipLow=vec3f(min(cull.clipLow.xy,ps),cull.clipLow.z);
  cull.clipHigh=vec3f(max(cull.clipHigh.xy,ps),cull.clipHigh.z);
 }
 let zLow=wHigh*viewToClip[2][2]+viewToClip[3][2];
 let zHigh=wLow*viewToClip[2][2]+viewToClip[3][2];
 let beforeNear=wLow<=zHigh;
 let behindNear=wHigh>zLow;
 let beforeFar=0.0<zHigh;
 let behindFar=0.0>=zLow;
 cull.pastNear=beforeNear;
 cull.pastFar=behindFar;
 cull.inMapView=behindNear&&beforeFar;
 cull.inDepth=cull.inMapView;
 if(wLow<=0.0&&wHigh>0.0){
  cull.clipLow=vec3f(-1.0);cull.clipHigh=vec3f(1.0);
 }else{
  cull.clipLow.z=zLow/wHigh;
  cull.clipHigh.z=zHigh/wLow;
 }
 let offView=any(sideLow>vec4f(0.0));
 cull.inMapView=cull.inMapView&&!offView;
 return cull;
}
/** The local point a box's frustum cull starts from: its centre under an orthographic view or
 *  without near clipping, else its corner, its centre less its extent. */
fn vsmBoxCullPoint(center:vec3f,extent:vec3f,isOrtho:bool,nearClip:bool)->vec3f{return select(center-extent,center,isOrtho||!nearClip);}
/** The frustum cull of a box: orthographic, or perspective when near clipping is on, from the clip
 *  image \`point\` of its \`vsmBoxCullPoint\` and the clip images of its three local axes. */
fn vsmBoxInView(point:vec4f,axisX:vec4f,axisY:vec4f,axisZ:vec4f,extent:vec3f,viewToClip:mat4x4f,isOrtho:bool,nearClip:bool)->VsmBoxInView{
 if(isOrtho||!nearClip){return vsmBoxInOrthoView(point.xyz,extent.x*axisX.xyz,extent.y*axisY.xyz,extent.z*axisZ.xyz,nearClip);}
 return vsmBoxInPerspectiveView(point,(2.0*extent.x)*axisX,(2.0*extent.y)*axisY,(2.0*extent.z)*axisZ,viewToClip);
}
/** The screen rect of a culled box, in pixels. */
fn vsmRectPixels(viewRect:vec4i,cull:VsmBoxInView)->vec4i{
 let uvRect=saturate(vec4f(cull.clipLow.xy,cull.clipHigh.xy)*vec4f(0.5,-0.5,0.5,-0.5)+0.5).xwzy;
 let viewSize=vec2f(viewRect.zw-viewRect.xy);
 var pixels=vec4i(uvRect*viewSize.xyxy+vec4f(viewRect.xyxy)+vec4f(0.5,0.5,-0.5,-0.5));
 pixels=vec4i(max(pixels.xy,viewRect.xy),min(pixels.zw,viewRect.zw-vec2i(1)));
 return pixels;
}

/** The mip level whose texels cover a rect (inclusive) within a desired footprint. */
fn vsmLevelHoldingRect(r:vec4i,spanTexels:i32)->i32{
 let maxSpan=spanTexels-1;
 let mipOffset=i32(floorLog2(u32(spanTexels)))-1;
 let spanLog2=firstLeadingBit(r.zw-r.xy);
 var mip=max(max(spanLog2.x,spanLog2.y)-mipOffset,0);
 let d=(r.zw>>vec2u(u32(mip)))-(r.xy>>vec2u(u32(mip)));
 if(any(d>vec2i(maxSpan))){mip+=1;}
 return mip;
}
`,
)

/**
 * The frustum cull of a caster's box (`casterSphere`, `VsmRenderCandidate`): its centre in the
 * map's shifted space and its three world half axes, the clip images of the half axes taken by the
 * shifted-to-clip matrix (a direction, w = 0) and handed with the extent one (`vsmBoxInView` reads
 * the edges as extent times axis). The cull's point is the centre, or the corner the centre less the
 * three half axes when a perspective map clips at the near plane (`vsmBoxCullPoint`). The cull of the
 * shadow views' descent (`../traversal/traversalWgsl.ts`) is this one, on a node's box.
 */
export const VSM_CASTER_BOX_CULL_WGSL = wgslBlock(
  'VSM_CASTER_BOX_CULL_WGSL',
  [VSM_BOX_VIEW_WGSL],
  `fn vsmCasterBoxInView(center:vec3f,a0:vec3f,a1:vec3f,a2:vec3f,shiftedToClip:mat4x4f,viewToClip:mat4x4f,isOrtho:bool,nearClip:bool)->VsmBoxInView{
 let point=vsmBoxCullPoint(center,a0+a1+a2,isOrtho,nearClip);
 return vsmBoxInView(shiftedToClip*vec4f(point,1.0),shiftedToClip*vec4f(a0,0.0),shiftedToClip*vec4f(a1,0.0),shiftedToClip*vec4f(a2,0.0),vec3f(1.0),viewToClip,isOrtho,nearClip);
}
/** Whether the box (centre \`center\` and half axes \`a0\` to \`a2\`, in a local light's shifted space, the
 *  light at its origin) lies wholly past the light's range: the gap between the origin and the box's
 *  axis-aligned bound (the oriented box lies in it) over \`range\`. */
fn vsmCasterPastRange(center:vec3f,a0:vec3f,a1:vec3f,a2:vec3f,range:f32)->bool{
 let gap=max(abs(center)-(abs(a0)+abs(a1)+abs(a2)),vec3f(0.0));
 return dot(gap,gap)>range*range;
}
`,
)

/**
 * The cull of a box and of its pages that the cache invalidation (`../invalidationWgsl.ts`) and the
 * render cull (`../render/renderCullWgsl.ts`) share: the frustum cull of a box given in clip space, its rect
 * in pixels, the mip level covering a rect, the flags of a page rect and their mask test, the
 * clip-space radius of a bounding sphere and the fine-caster threshold, and whether any valid page
 * overlaps a page rect.
 *
 * Each caller takes its box to clip space its own way — the invalidation through the instance's
 * local-to-world and then the view's world-to-clip, the render cull through one shifted-to-clip
 * matrix — and hands `vsmBoxInView` the clip image of the box's `vsmBoxCullPoint` and of its
 * axes: the floating-point operations of each are its own, in its own order.
 */
const boxCullText = (prefiltered: boolean) => `
/** Tests a page's flags against a mask: any of the any-bits and all of the all-bits. */
fn vsmMarksMatch(pageMarks:u32,markMask:u32)->bool{
 let anyBits=markMask&VSM_PAGE_TEST_ANY;
 if((pageMarks&anyBits)==0u){return false;}
 let allBits=markMask&${prefiltered ? 'VSM_PAGE_AUX_MASK' : 'VSM_PAGE_FINE'};
 return (pageMarks&allBits)==allBits;
}
/** Whether a page's flags satisfy the mask a render record's pages are matched by (the stale layer's
 *  mark, the wanted mark, the primary request mark): the render cull's emit and the bin that marks
 *  the pages drawn (\`renderBinWgsl.ts\`) ask the one test. */
fn vsmRecordMarksMatch(pageMarks:u32,markMask:u32)->bool{
 ${prefiltered ? 'return vsmMarksMatch(pageMarks,markMask);' : 'return (pageMarks&markMask)!=0u;'}
}
/** The flags of the pages of a page rect (not empty) whose first page is at a texel of the page
 *  table: the 2x2 gather of the hierarchical level that covers it, less the texels past the rect. */
fn vsmRectMarks(tableXY:vec2u,pagesRect:vec4u)->u32{
 let pyramidLevel=u32(vsmLevelHoldingRect(vec4i(pagesRect),2));
 var marks2x2=vsmGatherPageMarks(tableXY,pyramidLevel);
 let levelRect=pagesRect>>vec4u(pyramidLevel);
 if(levelRect.x==levelRect.z){marks2x2.y=0u;marks2x2.z=0u;}
 if(levelRect.y==levelRect.w){marks2x2.x=0u;marks2x2.y=0u;}
 return marks2x2.x|marks2x2.y|marks2x2.z|marks2x2.w;
}
/** Whether any valid page overlaps the page rect. */
fn vsmTouchesMappedPage(h:VsmHandle,mipLevel:u32,pagesRectIn:vec4u,askedMarks:u32,fineCaster:bool)->bool{
 if(any(pagesRectIn.zw<pagesRectIn.xy)){return false;}
 let wantedMarks=askedMarks|select(0u,VSM_PAGE_FINE,fineCaster);
 let entryCell=vsmTableEntryOf(h,mipLevel,pagesRectIn.xy);
 return vsmMarksMatch(vsmRectMarks(entryCell.tableXY,pagesRectIn),wantedMarks);
}
/** Whether any valid page overlaps a pixel rect (\`vsmTouchesMappedPage\` on its pages). */
fn vsmTouchesMappedPixelRect(h:VsmHandle,mipLevel:u32,pixels:vec4i,askedMarks:u32,fineCaster:bool)->bool{
 if(any(pixels.zw<pixels.xy)){return false;}
 return vsmTouchesMappedPage(h,mipLevel,vec4u(pixels)>>vec4u(VSM_LOG2_PAGE),askedMarks,fineCaster);
}
/** The clip-space radius estimate of a bounding sphere. */
fn vsmClipRadius(isOrtho:bool,radius:f32,shiftedCenter:vec3f,viewToClip:mat4x4f)->f32{
 if(isOrtho){return radius*viewToClip[0][0];}
 let radiusClip4=viewToClip*vec4f(radius,0.0,length(shiftedCenter),1.0);
 return abs(radiusClip4.x/radiusClip4.w);
}
/** Whether a caster is fine (drawn into fine pages alone), by its pixel radius against the thresholds;
 *  none when the setting leaves the casters out of the coarse pages (\`includeInCoarsePages\` 0: every caster is cluster
 *  geometry, which that setting never counts as detail). */
fn vsmIsFineCaster(staticLayer:bool,casterPixelRadius:f32)->bool{
 if(vsm.includeInCoarsePages==0u){return false;}
 if(staticLayer){return casterPixelRadius<vsm.detailPixelsStatic;}
 return casterPixelRadius<vsm.detailPixelsDynamicClusters;
}
`

/** The box cull block of a set whose layout says whether it holds the prefiltered distant shadow: a
 *  page's marks then hold the requests' auxiliary bits (`VSM_PAGE_AUX_MASK`), and a mask asks them all
 *  of the pages it reads. The render cull's and the shadow views' descent's; the invalidation's mask
 *  asks none, its text is the plain one. */
export const vsmBoxCullBlock = wgslVariants((prefiltered) =>
  wgslBlock(
    prefiltered ? 'VSM_BOX_CULL_PREFILTERED_WGSL' : 'VSM_BOX_CULL_WGSL',
    [
      VSM_BOX_VIEW_WGSL,
      VSM_CONSTANTS_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      VSM_PAGE_MARKS_GATHER_WGSL,
      ...prefilteredDeps(prefiltered),
    ],
    boxCullText(prefiltered),
  ),
)

export const VSM_BOX_CULL_WGSL = vsmBoxCullBlock(false)
