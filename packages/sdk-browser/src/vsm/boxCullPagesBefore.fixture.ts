// The page tests of the cache invalidation and of the render cull, and the invalidation of an
// instance's pages, as each module wrote them before they shared a box cull (`boxCullWgsl.ts`),
// word for word but for their comments: the reference `boxCullPages.test.ts` runs the shipped
// text against, bit for bit. With them, the instance flags and the static-caching helpers the
// invalidation read before it dropped the flags no host sets (`INVALIDATION_FLAGS_BEFORE`).

/** The instance flag bits before (the host set the first and the last alone). */
export const INVALIDATION_FLAGS_BEFORE = {
  VSM_BOX_CASTS: 1,
  VSM_BOX_CLUSTER: 2,
  VSM_BOX_SHAPE_MOVES: 4,
  VSM_BOX_SHAPE_ALWAYS: 8,
  VSM_BOX_SHAPE_CUTOFF: 16,
  VSM_BOX_NO_SHAPE_STALE: 32,
  VSM_BOX_MOVING: 64,
}

/** The invalidation's page rect, page tests and instance invalidation (`invalidationWgsl.ts`). */
export const INVALIDATION_PAGES = /* wgsl */ `
fn vsmPagesOfRect(r:VsmPixelRect)->vec4u{return vec4u(r.pixels)>>vec4u(VSM_LOG2_PAGE);}
fn vsmMappedRectPages(r:VsmPixelRect,h:VsmHandle,mipLevel:u32)->vec4u{
 let pagesRect=vsmPagesOfRect(r);
 let i=h.id*VSM_MIPS+mipLevel;
 var bounds=vec4u(0xFFFFFFFFu,0xFFFFFFFFu,0u,0u);
 if(i<arrayLength(&vsmMappedRects)){bounds=vsmMappedRects[i];}
 return vec4u(max(pagesRect.xy,bounds.xy),min(pagesRect.zw,bounds.zw));
}
fn vsmMarksMatch(pageMarks:u32,markMask:u32)->bool{
 let anyBits=markMask&VSM_PAGE_TEST_ANY;
 if((pageMarks&anyBits)==0u){return false;}
 let allBits=markMask&VSM_PAGE_FINE;
 return (pageMarks&allBits)==allBits;
}
fn vsmTouchesMappedPage(h:VsmHandle,mipLevel:u32,pagesRectIn:vec4u,askedMarks:u32,fineCaster:bool)->bool{
 if(any(pagesRectIn.zw<pagesRectIn.xy)){return false;}
 let wantedMarks=askedMarks|select(0u,VSM_PAGE_FINE,fineCaster);
 let pyramidLevel=u32(vsmLevelHoldingRect(vec4i(pagesRectIn),2));
 let entryCell=vsmTableEntryOf(h,mipLevel,pagesRectIn.xy);
 var marks2x2=vsmGatherPageMarks(entryCell.tableXY,pyramidLevel);
 let pagesRect=pagesRectIn>>vec4u(pyramidLevel);
 if(pagesRect.x==pagesRect.z){marks2x2.y=0u;marks2x2.z=0u;}
 if(pagesRect.y==pagesRect.w){marks2x2.x=0u;marks2x2.y=0u;}
 let pageMarks=marks2x2.x|marks2x2.y|marks2x2.z|marks2x2.w;
 return vsmMarksMatch(pageMarks,wantedMarks);
}
fn vsmClipRadius(isOrtho:bool,inst:VsmInvalidationInstance,axisScale:vec3f,localToShifted:mat4x4f,viewToClip:mat4x4f)->f32{
 let boxRadiusWorld=length(inst.boxExtent*axisScale);
 if(isOrtho){return boxRadiusWorld*viewToClip[0][0];}
 let shiftedCenter=(localToShifted*vec4f(inst.boxCentre,1.0)).xyz;
 let radiusClip4=viewToClip*vec4f(boxRadiusWorld,0.0,length(shiftedCenter),1.0);
 return abs(radiusClip4.x/radiusClip4.w);
}
fn vsmIsFineCaster(staticLayer:bool,clusterCaster:bool,casterPixelRadius:f32)->bool{
 if(staticLayer){return casterPixelRadius<vsm.detailPixelsStatic;}
 if(clusterCaster){return casterPixelRadius<vsm.detailPixelsCluster;}
 return casterPixelRadius<vsm.detailPixelsDynamic;
}
fn vsmShapeStalesCache(flags:u32,shapeMoves:bool)->bool{
 var invalidate=shapeMoves;
 invalidate=invalidate||((flags&VSM_BOX_SHAPE_ALWAYS)!=0u);
 invalidate=invalidate&&((flags&VSM_BOX_NO_SHAPE_STALE)==0u);
 return invalidate;
}
fn vsmShapeAllowed(inst:VsmInvalidationInstance,pd:VsmProjectionData)->bool{
 if((inst.flags&VSM_BOX_SHAPE_ALWAYS)!=0u){return true;}
 let shapeEvaluated=(inst.flags&VSM_BOX_SHAPE_MOVES)!=0u;
 let shapeCutoff=(inst.flags&VSM_BOX_SHAPE_CUTOFF)!=0u;
 if(shapeEvaluated&&shapeCutoff&&vsmHandleIsValid(pd.handle)){
  return pd.levelShapeCutoffSq<=inst.boxShapeCutoffSq;
 }
 return shapeEvaluated;
}
fn vsmCachesAsStatic(inst:VsmInvalidationInstance,viewUncached:bool,shapeAllowed:bool)->bool{
 if(viewUncached){return false;}
 if(vsmShapeStalesCache(inst.flags,shapeAllowed)){return false;}
 if((inst.flags&VSM_BOX_MOVING)!=0u){return false;}
 return true;
}
fn vsmStaleBoxPages(pd:VsmProjectionData,inst:VsmInvalidationInstance){
 let clusterBox=(inst.flags&VSM_BOX_CLUSTER)!=0u;
 let sunMap=pd.lightKind==LIGHT_KIND_DIRECTIONAL;
 let translation=(vec3f(inst.localToWorld0.w,inst.localToWorld1.w,inst.localToWorld2.w)+pd.originShiftHigh)
  +(inst.translationLow+pd.originShiftLow);
 let localToShifted=mat4x4f(
  vec4f(inst.localToWorld0.xyz,0.0),
  vec4f(inst.localToWorld1.xyz,0.0),
  vec4f(inst.localToWorld2.xyz,0.0),
  vec4f(translation,1.0));
 let axisScale=vec3f(length(inst.localToWorld0.xyz),length(inst.localToWorld1.xyz),length(inst.localToWorld2.xyz));
 if(!sunMap){
  let boxRadius=length(inst.boxExtent*axisScale);
  let shiftedCenter=(localToShifted*vec4f(inst.boxCentre,1.0)).xyz;
  let r=pd.lightRange+boxRadius;
  if(dot(shiftedCenter,shiftedCenter)>r*r){return;}
 }
 let uvToClip=mat4x4f(vec4f(2.0,0.0,0.0,0.0),vec4f(0.0,-2.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(-1.0,1.0,0.0,1.0));
 let isOrtho=sunMap;
 let nearClip=!sunMap;
 let cull=vsmShiftedBoxInView(inst.boxCentre,inst.boxExtent,localToShifted,
  uvToClip*pd.shiftedToMapUv,pd.lightViewToClip,isOrtho,nearClip);
 var pixelRadius=vsmClipRadius(isOrtho,inst,axisScale,localToShifted,pd.lightViewToClip)*f32(VSM_LEVEL0_TEXELS);
 if(!cull.inMapView){return;}
 let shapeAllowed=vsmShapeAllowed(inst,pd);
 let staticBox=vsmCachesAsStatic(inst,pd.uncached,shapeAllowed);
 let staleBits=select(VSM_META_DYNAMIC_STALE,VSM_META_STATIC_STALE,staticBox);
 let staleStatic=(staleBits&VSM_META_STATIC_STALE)!=0u;
 if(pd.handle.isSinglePage){
  vsmMarkStale(vsmTableEntryOf(pd.handle,VSM_MIPS-1u,vec2u(0u)),VSM_META_STATIC_STALE);
  return;
 }
 let mipCount=select(1,i32(VSM_MIPS),pd.levelsLeft<=0);
 for(var mipLevel=i32(pd.finestMip);mipLevel<mipCount;mipLevel++){
  let mip=u32(mipLevel);
  let mapTexels=i32(VSM_LEVEL0_TEXELS>>mip);
  let rect=vsmPixelRectOf(vec4i(0,0,mapTexels,mapTexels),cull.clipLow,cull.clipHigh,4);
  let pagesRect=vsmMappedRectPages(rect,pd.handle,mip);
  let fineCaster=vsmIsFineCaster(staleStatic,clusterBox,pixelRadius);
  pixelRadius*=0.5;
  if(vsmTouchesMappedPage(pd.handle,mip,pagesRect,VSM_PAGE_WANTED,fineCaster)){
   let levelOffset=vsmTableLevelOrigin(pd.handle,mip);
   let wantedBits=VSM_PAGE_WANTED|select(0u,VSM_PAGE_FINE,pd.coarseDynamicCached&&!staleStatic);
   for(var y=pagesRect.y;y<=pagesRect.w;y++){
    for(var x=pagesRect.x;x<=pagesRect.z;x++){
     let markCell=vsmTableEntryAt(levelOffset,mip,vec2u(x,y));
     let pageMarks=vsmPageMarkWord(markCell);
     if((pageMarks&wantedBits)==wantedBits){
      vsmMarkStale(markCell,staleBits);
     }
    }
   }
  }
 }
}
`

/** The render cull's page overlap and fine-caster test (`renderCullWgsl.ts`). */
export const RENDER_PAGES = /* wgsl */ `
fn vsmTouchesMappedPage(h:VsmHandle,mipLevel:u32,pixels:vec4i,askedMarks:u32,fineCaster:bool,useCover:bool)->bool{
 if(any(pixels.zw<pixels.xy)){return false;}
 let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
 let pyramidLevel=u32(vsmLevelHoldingRect(vec4i(pagesRect),2));
 let wantedMarks=askedMarks|select(0u,VSM_PAGE_FINE,fineCaster);
 let entryCell=vsmTableEntryOf(h,mipLevel,pagesRect.xy);
 var marks2x2=vsmGatherPageMarks(entryCell.tableXY,pyramidLevel);
 let levelRect=pagesRect>>vec4u(pyramidLevel);
 if(levelRect.x==levelRect.z){marks2x2.y=0u;marks2x2.z=0u;}
 if(levelRect.y==levelRect.w){marks2x2.x=0u;marks2x2.y=0u;}
 let pageMarks=marks2x2.x|marks2x2.y|marks2x2.z|marks2x2.w;
 if(vsmMarksMatch(pageMarks,wantedMarks)){
  if(useCover){
   let halfPageRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE-1u);
   let coverLevel=u32(vsmLevelHoldingRect(vec4i(halfPageRect),2));
   let coverCell=entryCell.tableXY*2u+(halfPageRect.xy&vec2u(1u));
   let offsetMip=halfPageRect.xy>>vec2u(coverLevel);
   let offset=offsetMip<<vec2u(VSM_LOG2_COVER_CELLS+coverLevel-1u);
   let cellRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE-VSM_LOG2_COVER_CELLS);
   let subRect=cellRect-offset.xyxy;
   let subRectAtLevel=subRect>>vec4u(coverLevel);
   let cover8x8=vsmGatherCover(coverCell,coverLevel);
   return vsmMaskRectHits(cover8x8,subRectAtLevel.xy,subRectAtLevel.zw);
  }
  return true;
 }
 return false;
}
fn vsmIsFineCaster(staticLayer:bool,casterPixelRadius:f32)->bool{
 if(staticLayer){return casterPixelRadius<vsm.detailPixelsStatic;}
 return casterPixelRadius<vsm.detailPixelsDynamic;
}
`
