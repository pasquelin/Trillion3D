// The box culls of the cache invalidation and of the render cull before they shared one
// (`boxCullWgsl.ts`), word for word but for comments: what `boxCull.test.ts` holds the shipped to.

/** The invalidation's frustum box cull and screen rect (`invalidationWgsl.ts`). */
export const INVALIDATION_BOX_CULL = /* wgsl */ `
const VSM_F32_MAX_BEFORE:f32=3.402823466e+38;
struct VsmBoxInViewBefore{
 clipLow:vec3f,
 clipHigh:vec3f,
 pastFar:bool,
 pastNear:bool,
 offSide:bool,
 inMapView:bool,
}
struct VsmPixelRect{
 pixels:vec4i,
 coversCentre:bool,
 pyramidTexels:vec4i,
 pyramidRectLevel:i32,
 depth:f32,
}
fn vsmLevelHoldingRect(rectPixels:vec4i,spanTexels:i32)->i32{
 let maxSpan=spanTexels-1;
 let mipOffset=i32(log2(f32(spanTexels)))-1;
 let spanLog2XY=firstLeadingBit(rectPixels.zw-rectPixels.xy);
 var mipLevel=max(max(spanLog2XY.x,spanLog2XY.y)-mipOffset,0);
 let m=vec2u(u32(mipLevel));
 if(any(((rectPixels.zw>>m)-(rectPixels.xy>>m))>vec2i(maxSpan))){mipLevel+=1;}
 return mipLevel;
}
fn vsmPixelRectOf(viewRect:vec4i,clipLowIn:vec3f,clipHighIn:vec3f,spanTexels:i32)->VsmPixelRect{
 var r:VsmPixelRect;
 r.depth=clipHighIn.z;
 let uvRect=saturate(vec4f(clipLowIn.xy,clipHighIn.xy)*vec4f(0.5,-0.5,0.5,-0.5)+0.5).xwzy;
 let viewSize=vec2f(viewRect.zw-viewRect.xy);
 r.pixels=vec4i(uvRect*viewSize.xyxy+vec4f(viewRect.xyxy)+vec4f(0.5,0.5,-0.5,-0.5));
 r.pixels=vec4i(max(r.pixels.xy,viewRect.xy),min(r.pixels.zw,viewRect.zw-1));
 r.coversCentre=all(r.pixels.zw>=r.pixels.xy);
 r.pyramidTexels=vec4i(r.pixels.xy,max(r.pixels.xy,r.pixels.zw));
 r.pyramidTexels=r.pyramidTexels>>vec4u(1u);
 r.pyramidRectLevel=vsmLevelHoldingRect(r.pyramidTexels,spanTexels);
 r.pyramidTexels=r.pyramidTexels>>vec4u(u32(r.pyramidRectLevel));
 return r;
}
fn vsmMin3v2(a:vec2f,b:vec2f,c:vec2f)->vec2f{return min(a,min(b,c));}
fn vsmMax3v2(a:vec2f,b:vec2f,c:vec2f)->vec2f{return max(a,max(b,c));}
fn vsmShiftedBoxOrtho(center:vec3f,extent:vec3f,localToWorld:mat4x4f,worldToClip:mat4x4f,nearClip:bool)->VsmBoxInViewBefore{
 var c:VsmBoxInViewBefore;
 let clipCentre=(worldToClip*(localToWorld*vec4f(center,1.0))).xyz;
 let clipExtent=abs(extent.x*(worldToClip*localToWorld[0]).xyz)+abs(extent.y*(worldToClip*localToWorld[1]).xyz)+abs(extent.z*(worldToClip*localToWorld[2]).xyz);
 c.clipLow=clipCentre-clipExtent;
 c.clipHigh=clipCentre+clipExtent;
 c.pastFar=c.clipLow.z<0.0;
 c.pastNear=c.clipHigh.z>1.0;
 c.inMapView=c.clipHigh.z>0.0;
 if(nearClip){c.inMapView=c.inMapView&&c.clipLow.z<1.0;}
 let offView=any((c.clipHigh.xy<vec2f(-1.0))|(c.clipLow.xy>vec2f(1.0)));
 c.offSide=c.inMapView&&offView;
 c.inMapView=c.inMapView&&!offView;
 return c;
}
fn vsmShiftedBoxPerspective(center:vec3f,extent:vec3f,localToWorld:mat4x4f,worldToClip:mat4x4f,viewToClip:mat4x4f)->VsmBoxInViewBefore{
 var c:VsmBoxInViewBefore;
 let dx=(2.0*extent.x)*(worldToClip*localToWorld[0]);
 let dy=(2.0*extent.y)*(worldToClip*localToWorld[1]);
 var wLow=VSM_F32_MAX_BEFORE;
 var wHigh=-VSM_F32_MAX_BEFORE;
 var sideLow=vec4f(1.0);
 c.clipLow=vec3f(1.0);
 c.clipHigh=vec3f(-1.0);
 let dz=(2.0*extent.z)*(worldToClip*localToWorld[2]);
 let corner000=worldToClip*(localToWorld*vec4f(center-extent,1.0));
 let corner100=corner000+dz;
 let corner001=corner000+dx;
 let corner101=corner100+dx;
 let corner011=corner001+dy;
 let corner111=corner101+dy;
 let corner010=corner011-dx;
 let corner110=corner111-dx;
 var pcs=array<vec4f,8>(corner000,corner100,corner001,corner101,corner011,corner111,corner010,corner110);
 var rectMinXY=c.clipLow.xy;
 var rectMaxXY=c.clipHigh.xy;
 for(var k=0u;k<8u;k+=2u){
  let p0=pcs[k];
  let p1=pcs[k+1u];
  wLow=min(wLow,min(p0.w,p1.w));
  wHigh=max(wHigh,max(p0.w,p1.w));
  sideLow=min(sideLow,min(vec4f(p0.xy,-p0.xy)-p0.w,vec4f(p1.xy,-p1.xy)-p1.w));
  let ps0=p0.xy/p0.w;
  let ps1=p1.xy/p1.w;
  rectMinXY=vsmMin3v2(rectMinXY,ps0,ps1);
  rectMaxXY=vsmMax3v2(rectMaxXY,ps0,ps1);
 }
 c.clipLow=vec3f(rectMinXY,c.clipLow.z);
 c.clipHigh=vec3f(rectMaxXY,c.clipHigh.z);
 let zLow=wHigh*viewToClip[2][2]+viewToClip[3][2];
 let zHigh=wLow*viewToClip[2][2]+viewToClip[3][2];
 let beforeNear=wLow<=zHigh;
 let behindNear=wHigh>zLow;
 let beforeFar=0.0<zHigh;
 let behindFar=0.0>=zLow;
 c.pastNear=beforeNear;
 c.pastFar=behindFar;
 c.inMapView=behindNear&&beforeFar;
 if(wLow<=0.0&&wHigh>0.0){
  c.clipLow=vec3f(-1.0);
  c.clipHigh=vec3f(1.0);
 }else{
  c.clipLow.z=zLow/wHigh;
  c.clipHigh.z=zHigh/wLow;
 }
 let offView=any(sideLow>vec4f(0.0));
 c.offSide=c.inMapView&&offView;
 c.inMapView=c.inMapView&&!offView;
 return c;
}
fn vsmShiftedBoxInView(center:vec3f,extent:vec3f,localToWorld:mat4x4f,worldToClip:mat4x4f,viewToClip:mat4x4f,isOrtho:bool,nearClip:bool)->VsmBoxInViewBefore{
 if(isOrtho||!nearClip){return vsmShiftedBoxOrtho(center,extent,localToWorld,worldToClip,nearClip);}
 return vsmShiftedBoxPerspective(center,extent,localToWorld,worldToClip,viewToClip);
}
`;

/** The render cull's frustum box cull, its mip level of a rect and its rect in pixels
 *  (`renderCullWgsl.ts`). */
export const RENDER_BOX_CULL = /* wgsl */ `
struct VsmBoxInView{clipLow:vec3f,clipHigh:vec3f,pastFar:bool,pastNear:bool,inMapView:bool,}
fn vsmShiftedBoxOrtho(center:vec3f,extent:vec3f,m:mat4x4f,nearClip:bool)->VsmBoxInView{
 var cull:VsmBoxInView;
 let clipCentre=(m*vec4f(center,1.0)).xyz;
 let clipExtent=abs(extent.x*m[0].xyz)+abs(extent.y*m[1].xyz)+abs(extent.z*m[2].xyz);
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
fn vsmShiftedBoxPerspective(center:vec3f,extent:vec3f,m:mat4x4f,viewToClip:mat4x4f)->VsmBoxInView{
 var cull:VsmBoxInView;
 let dx=(2.0*extent.x)*m[0];
 let dy=(2.0*extent.y)*m[1];
 let dz=(2.0*extent.z)*m[2];
 var wLow=3.402823466e38;var wHigh=-3.402823466e38;
 var sideLow=vec4f(1.0);
 cull.clipLow=vec3f(1.0);cull.clipHigh=vec3f(-1.0);
 let corner000=m*vec4f(center-extent,1.0);
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
fn vsmShiftedBoxInView(center:vec3f,extent:vec3f,m:mat4x4f,viewToClip:mat4x4f,isOrtho:bool,nearClip:bool)->VsmBoxInView{
 if(isOrtho||!nearClip){return vsmShiftedBoxOrtho(center,extent,m,nearClip);}
 return vsmShiftedBoxPerspective(center,extent,m,viewToClip);
}
fn vsmLevelHoldingRect(r:vec4i,spanTexels:i32)->i32{
 let maxSpan=spanTexels-1;
 let mipOffset=i32(log2(f32(spanTexels)))-1;
 let spanLog2=firstLeadingBit(r.zw-r.xy);
 var mip=max(max(spanLog2.x,spanLog2.y)-mipOffset,0);
 let d=(r.zw>>vec2u(u32(mip)))-(r.xy>>vec2u(u32(mip)));
 if(any(d>vec2i(maxSpan))){mip+=1;}
 return mip;
}
fn vsmRectPixels(viewRect:vec4i,cull:VsmBoxInView)->vec4i{
 let uvRect=saturate(vec4f(cull.clipLow.xy,cull.clipHigh.xy)*vec4f(0.5,-0.5,0.5,-0.5)+0.5).xwzy;
 let viewSize=vec2f(viewRect.zw-viewRect.xy);
 var pixels=vec4i(uvRect*viewSize.xyxy+vec4f(viewRect.xyxy)+vec4f(0.5,0.5,-0.5,-0.5));
 pixels=vec4i(max(pixels.xy,viewRect.xy),min(pixels.zw,viewRect.zw-vec2i(1)));
 return pixels;
}
`;
