/**
 * Cache invalidation shaders (step 7): the load-balanced instance-page invalidation, with the
 * helpers it needs (frustum box cull, screen rect, mip level of a rect — the render cull's, from
 * `boxCullWgsl.ts` —, page overlap, page cache).
 *
 * Everything reads the PREVIOUS frame's VSM state: `vsm` = prev uniforms, prev projection data,
 * prev page marks, prev allocated page rect bounds; the invalidation bits are OR'ed into the prev
 * page requests, which the pool's page carry (step 4) folds into the pool page info.
 *
 * Instance data: a compact `VsmInvalidationInstance` array (96 B each) is uploaded per pass with
 * only the fields the invalidation reads: the local-to-world (rotation-scale + double translation
 * split high/low), the local bounds and two flags (casts shadows, cached as dynamic). Items address
 * it as batch items (offset, count, payload).
 */
import { VSM_BOX_CULL_WGSL } from './boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_MARKS_GATHER_WGSL,
  VSM_STRUCTS_WGSL,
} from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL, VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { vsmBindingsWgsl, type VsmBindingSpec } from './resources.ts'
import { VSM_UNIFORMS_WGSL } from './uniforms.ts'
import type { VsmLayout } from './layout.ts'
import { FLAT_INDEX_WGSL } from '../gpu/dispatch/grid.ts'

/** Thread group size of the instance load balancer. */
export const VSM_INVALIDATION_GROUP_SIZE = 64
/** Bytes per `VsmInvalidationInstance`. */
export const VSM_INVALIDATION_INSTANCE_BYTES = 96
/** Bytes of `VsmInvalidationParams`. */
export const VSM_INVALIDATION_PARAMS_BYTES = 16

/** Instance flags, the two the host knows of a box: it casts shadows (a valid instance), and it is
 *  cached as dynamic (the engine's box moving), else as static. */
export const VSM_BOX_CASTS = 1 << 0
export const VSM_BOX_MOVING = 1 << 1

/** Group 0: the previous frame's VSM state */
export const VSM_INVALIDATION_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0, prev: true, name: 'vsm' },
  { resource: 'projectionData', binding: 1, prev: true, name: 'vsmProjectionData' },
  { resource: 'pageMarks', binding: 2, prev: true, name: 'vsmPageMarks' },
  {
    resource: 'mappedRects',
    binding: 3,
    prev: true,
    name: 'vsmMappedRects',
  },
  {
    resource: 'pageRequests',
    binding: 4,
    prev: true,
    access: 'atomic',
    name: 'vsmPageRequests',
  },
]

/** Group 1: 0 params (uniform), 1 instances, 2 items. */
const VSM_INVALIDATION_GROUP1_WGSL = /* wgsl */ `
struct VsmInvalidationParams{invItemCount:u32,boxCount:u32,pad:vec2u,}
struct VsmInvalidationInstance{
 localToWorld0:vec4f,
 localToWorld1:vec4f,
 localToWorld2:vec4f,
 translationLow:vec3f,
 pad:u32,
 boxCentre:vec3f,
 flags:u32,
 boxExtent:vec3f,
}
struct VsmInvalidationItem{firstBox:u32,boxCount:u32,payload:u32,prefix:u32,}
@group(1) @binding(0) var<uniform> vsmInv:VsmInvalidationParams;
@group(1) @binding(1) var<storage,read> vsmInvInstances:array<VsmInvalidationInstance>;
@group(1) @binding(2) var<storage,read> vsmInvItems:array<VsmInvalidationItem>;
const VSM_BOX_CASTS:u32=${VSM_BOX_CASTS}u;
const VSM_BOX_MOVING:u32=${VSM_BOX_MOVING}u;
const VSM_INVALIDATION_GROUP_SIZE:u32=${VSM_INVALIDATION_GROUP_SIZE}u;
`

/** Page-rect overlap and static caching (the box cull, its rect and the fine-caster test are the
 *  shared `VSM_BOX_CULL_WGSL`'s). */
const VSM_PAGE_OVERLAP_WGSL = /* wgsl */ `
/** The frustum cull of an instance's local box, taken to clip space through its local-to-world
 *  then the view's world-to-clip: orthographic, or perspective when near clipping is on. */
fn vsmBoxInMapView(center:vec3f,extent:vec3f,localToWorld:mat4x4f,worldToClip:mat4x4f,viewToClip:mat4x4f,isOrtho:bool,nearClip:bool)->VsmBoxInView{
 if(isOrtho||!nearClip){
  return vsmBoxInOrthoView((worldToClip*(localToWorld*vec4f(center,1.0))).xyz,
   extent.x*(worldToClip*localToWorld[0]).xyz,extent.y*(worldToClip*localToWorld[1]).xyz,extent.z*(worldToClip*localToWorld[2]).xyz,nearClip);
 }
 return vsmBoxInPerspectiveView(worldToClip*(localToWorld*vec4f(center-extent,1.0)),
  (2.0*extent.x)*(worldToClip*localToWorld[0]),(2.0*extent.y)*(worldToClip*localToWorld[1]),(2.0*extent.z)*(worldToClip*localToWorld[2]),viewToClip);
}
/** Clips the page rect of a pixel rect to the allocated bounds (at map id · 8 + mip). */
fn vsmMappedRectPages(pixels:vec4i,h:VsmHandle,mipLevel:u32)->vec4u{
 let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
 let i=h.id*VSM_MIPS+mipLevel;
 var bounds=vec4u(0xFFFFFFFFu,0xFFFFFFFFu,0u,0u);
 if(i<arrayLength(&vsmMappedRects)){bounds=vsmMappedRects[i];}
 return vec4u(max(pagesRect.xy,bounds.xy),min(pagesRect.zw,bounds.zw));
}
/** Whether any valid page overlaps the page rect. */
fn vsmTouchesMappedPage(h:VsmHandle,mipLevel:u32,pagesRectIn:vec4u,askedMarks:u32,fineCaster:bool)->bool{
 if(any(pagesRectIn.zw<pagesRectIn.xy)){return false;}
 let wantedMarks=askedMarks|select(0u,VSM_PAGE_FINE,fineCaster);
 let entryCell=vsmTableEntryOf(h,mipLevel,pagesRectIn.xy);
 return vsmMarksMatch(vsmRectMarks(entryCell.tableXY,pagesRectIn),wantedMarks);
}
/** Whether an instance is cached as static: its view is cached and its box does not move. */
fn vsmCachesAsStatic(inst:VsmInvalidationInstance,viewUncached:bool)->bool{
 return !viewUncached&&(inst.flags&VSM_BOX_MOVING)==0u;
}
`

/** The instance page invalidation and its load-balanced entry point. */
const VSM_INVALIDATE_INSTANCE_PAGES_WGSL = /* wgsl */ `
fn vsmMarkStale(o:VsmTableCell,flags:u32){
 let i=vsmTableIndex(o.tableXY);
 if(i<arrayLength(&vsmPageRequests)){atomicOr(&vsmPageRequests[i],flags);}
}
/** Invalidates the pages of one instance. */
fn vsmStaleBoxPages(pd:VsmProjectionData,inst:VsmInvalidationInstance){
 let sunMap=pd.lightKind==LIGHT_KIND_DIRECTIONAL;
 // The shadow view's shifted space (the high/low translation summed with the origin shift).
 let translation=(vec3f(inst.localToWorld0.w,inst.localToWorld1.w,inst.localToWorld2.w)+pd.originShiftHigh)
  +(inst.translationLow+pd.originShiftLow);
 let localToShifted=mat4x4f(
  vec4f(inst.localToWorld0.xyz,0.0),
  vec4f(inst.localToWorld1.xyz,0.0),
  vec4f(inst.localToWorld2.xyz,0.0),
  vec4f(translation,1.0));
 let axisScale=vec3f(length(inst.localToWorld0.xyz),length(inst.localToWorld1.xyz),length(inst.localToWorld2.xyz));
 let boxRadius=length(inst.boxExtent*axisScale);
 // The bounds' shifted centre, which a local light's tests alone read.
 var shiftedCenter=vec3f(0.0);
 // Distance cull for local lights.
 if(!sunMap){
  shiftedCenter=(localToShifted*vec4f(inst.boxCentre,1.0)).xyz;
  let r=pd.lightRange+boxRadius;
  if(dot(shiftedCenter,shiftedCenter)>r*r){return;}
 }
 // Back to clip space: uvToClip · shiftedToShadowUV.
 let uvToClip=mat4x4f(vec4f(2.0,0.0,0.0,0.0),vec4f(0.0,-2.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(-1.0,1.0,0.0,1.0));
 let isOrtho=sunMap;
 let nearClip=!sunMap;
 let cull=vsmBoxInMapView(inst.boxCentre,inst.boxExtent,localToShifted,
  uvToClip*pd.shiftedToMapUv,pd.lightViewToClip,isOrtho,nearClip);
 var pixelRadius=vsmClipRadius(isOrtho,boxRadius,shiftedCenter,pd.lightViewToClip)*f32(VSM_LEVEL0_TEXELS);
 if(!cull.inMapView){return;}
 let staticBox=vsmCachesAsStatic(inst,pd.uncached);
 let staleBits=select(VSM_META_DYNAMIC_STALE,VSM_META_STATIC_STALE,staticBox);
 let staleStatic=(staleBits&VSM_META_STATIC_STALE)!=0u;
 if(pd.handle.isSinglePage){
  // Invalidate the one page (always as static).
  vsmMarkStale(vsmTableEntryOf(pd.handle,VSM_MIPS-1u,vec2u(0u)),VSM_META_STATIC_STALE);
  return;
 }
 let mipCount=select(1,i32(VSM_MIPS),pd.levelsLeft<=0);
 for(var mipLevel=i32(pd.finestMip);mipLevel<mipCount;mipLevel++){
  let mip=u32(mipLevel);
  let mapTexels=i32(VSM_LEVEL0_TEXELS>>mip);
  let pixels=vsmRectPixels(vec4i(0,0,mapTexels,mapTexels),cull);
  // All allocated pages, cached or not, referenced this frame or not.
  let pagesRect=vsmMappedRectPages(pixels,pd.handle,mip);
  let fineCaster=vsmIsFineCaster(staleStatic,pixelRadius);
  pixelRadius*=0.5;
  // Hierarchical test: skip areas without any allocated page.
  if(vsmTouchesMappedPage(pd.handle,mip,pagesRect,VSM_PAGE_WANTED,fineCaster)){
   let levelOffset=vsmTableLevelOrigin(pd.handle,mip);
   let wantedBits=VSM_PAGE_WANTED|select(0u,VSM_PAGE_FINE,pd.coarseDynamicCached&&!staleStatic);
   for(var y=pagesRect.y;y<=pagesRect.w;y++){
    for(var x=pagesRect.x;x<=pagesRect.z;x++){
     let markCell=vsmTableEntryAt(levelOffset,mip,vec2u(x,y));
     let pageMarks=vsmPageMarkWord(markCell);
     if((pageMarks&wantedBits)==wantedBits){
      // Not through the page table: pages not requested last frame are not in it, but still
      // hold cached data. The next page address remap picks the bits up.
      vsmMarkStale(markCell,staleBits);
     }
    }
   }
  }
 }
}
/** The load-balanced entry point: one thread per (item, instance of the item), in rows. */
${FLAT_INDEX_WGSL}@compute @workgroup_size(VSM_INVALIDATION_GROUP_SIZE)
fn vsmStaleBoxes(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lidx:u32){
 let thread=flatIndex(wid,nwg,1u)*VSM_INVALIDATION_GROUP_SIZE+lidx;
 if(thread>=vsmInv.boxCount||vsmInv.invItemCount==0u){return;}
 // Item of this thread: the last whose prefix is <= thread.
 var lo=0u;
 var hi=vsmInv.invItemCount-1u;
 while(lo<hi){
  let mid=(lo+hi+1u)>>1u;
  if(vsmInvItems[mid].prefix<=thread){lo=mid;}else{hi=mid-1u;}
 }
 let item=vsmInvItems[lo];
 let indexInItem=thread-item.prefix;
 if(indexInItem>=item.boxCount){return;}
 let boxIndex=item.firstBox+indexInItem;
 if(boxIndex>=arrayLength(&vsmInvInstances)){return;}
 let inst=vsmInvInstances[boxIndex];
 // A valid instance that casts shadows.
 if((inst.flags&VSM_BOX_CASTS)==0u){return;}
 let mapId=item.payload;
 if(mapId>=arrayLength(&vsmProjectionData)){return;}
 let pd=vsmProjectionOf(vsmHandleFromId(mapId));
 vsmStaleBoxPages(pd,inst);
}
`

/** The whole instance invalidation module (entry `vsmStaleBoxes`). */
export function vsmInvalidationWgsl(layout: VsmLayout) {
  return [
    VSM_CONSTANTS_WGSL,
    VSM_UNIFORMS_WGSL,
    VSM_HANDLE_WGSL,
    VSM_STRUCTS_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_PROJECTION_DATA_WGSL,
    vsmBindingsWgsl(0, VSM_INVALIDATION_SPECS, layout),
    VSM_INVALIDATION_GROUP1_WGSL,
    VSM_PROJECTION_DATA_READ_WGSL,
    VSM_PAGE_MARKS_GATHER_WGSL,
    VSM_BOX_CULL_WGSL,
    VSM_PAGE_OVERLAP_WGSL,
    VSM_INVALIDATE_INSTANCE_PAGES_WGSL,
  ].join('\n')
}
