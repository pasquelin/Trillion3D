import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { FLOAT32_MAX } from '../../../math/src/wgsl/constants.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_PAGE_MARKS_GATHER_WGSL } from './pageTableWgsl.ts'
/**
 * The cull of a box and of its pages that the cache invalidation (`invalidationWgsl.ts`) and the
 * render cull (`renderCullWgsl.ts`) share: the frustum cull of a box given in clip space, its rect
 * in pixels, the mip level covering a rect, the flags of a page rect and their mask test, the
 * clip-space radius of a bounding sphere and the fine-caster threshold.
 *
 * Each caller takes its box to clip space its own way — the invalidation through the instance's
 * local-to-world and then the view's world-to-clip, the render cull through one shifted-to-clip
 * matrix — and hands the cull the clip-space centre (or corner) and axes it computed: the
 * floating-point operations of each are its own, in its own order.
 */
export const VSM_BOX_CULL_WGSL = wgslBlock(
  'VSM_BOX_CULL_WGSL',
  [FLOAT32_MAX, VSM_CONSTANTS_WGSL, VSM_PAGE_MARKS_GATHER_WGSL],
  `
struct VsmBoxInView{clipLow:vec3f,clipHigh:vec3f,pastFar:bool,pastNear:bool,inMapView:bool,}
/** The mip level whose texels cover a rect (inclusive) within a desired footprint. */
fn vsmLevelHoldingRect(r:vec4i,spanTexels:i32)->i32{
 let maxSpan=spanTexels-1;
 let mipOffset=i32(log2(f32(spanTexels)))-1;
 let spanLog2=firstLeadingBit(r.zw-r.xy);
 var mip=max(max(spanLog2.x,spanLog2.y)-mipOffset,0);
 let d=(r.zw>>vec2u(u32(mip)))-(r.xy>>vec2u(u32(mip)));
 if(any(d>vec2i(maxSpan))){mip+=1;}
 return mip;
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
  let ps=p.xy/p.w;
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
/** The screen rect of a culled box, in pixels. */
fn vsmRectPixels(viewRect:vec4i,cull:VsmBoxInView)->vec4i{
 let uvRect=saturate(vec4f(cull.clipLow.xy,cull.clipHigh.xy)*vec4f(0.5,-0.5,0.5,-0.5)+0.5).xwzy;
 let viewSize=vec2f(viewRect.zw-viewRect.xy);
 var pixels=vec4i(uvRect*viewSize.xyxy+vec4f(viewRect.xyxy)+vec4f(0.5,0.5,-0.5,-0.5));
 pixels=vec4i(max(pixels.xy,viewRect.xy),min(pixels.zw,viewRect.zw-vec2i(1)));
 return pixels;
}
/** Tests a page's flags against a mask: any of the any-bits and all of the all-bits. */
fn vsmMarksMatch(pageMarks:u32,markMask:u32)->bool{
 let anyBits=markMask&VSM_PAGE_TEST_ANY;
 if((pageMarks&anyBits)==0u){return false;}
 let allBits=markMask&VSM_PAGE_FINE;
 return (pageMarks&allBits)==allBits;
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
/** The clip-space radius estimate of a bounding sphere. */
fn vsmClipRadius(isOrtho:bool,radius:f32,shiftedCenter:vec3f,viewToClip:mat4x4f)->f32{
 if(isOrtho){return radius*viewToClip[0][0];}
 let radiusClip4=viewToClip*vec4f(radius,0.0,length(shiftedCenter),1.0);
 return abs(radiusClip4.x/radiusClip4.w);
}
/** Whether a caster is fine (drawn into fine pages alone), by its pixel radius against the thresholds. */
fn vsmIsFineCaster(staticLayer:bool,casterPixelRadius:f32)->bool{
 if(staticLayer){return casterPixelRadius<vsm.detailPixelsStatic;}
 return casterPixelRadius<vsm.detailPixelsDynamic;
}
`,
)
