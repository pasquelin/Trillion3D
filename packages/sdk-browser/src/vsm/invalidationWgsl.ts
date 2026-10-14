import { wgslConsts } from '../../../math/src/wgsl/consts.ts'
/**
 * Cache invalidation shaders (step 7): the load-balanced instance-page invalidation, with the
 * helpers it needs (frustum box cull, screen rect, mip level of a rect — the render cull's, from
 * `boxCullWgsl.ts` —, page overlap, page cache).
 *
 * Everything reads the PREVIOUS frame's VSM state: `vsm` = prev uniforms, prev projection data,
 * prev page marks, prev allocated page rect bounds; the invalidation bits are OR'ed into the prev
 * page requests, which the pool's page carry (step 4) folds into the pool page info.
 *
 * An instance (`VsmInvalidationInstance`) holds only the fields the invalidation reads: the
 * local-to-world (rotation-scale + double translation split high/low), the local bounds and two
 * flags (casts shadows, cached as dynamic). The one entry that builds them is the shadow changes'
 * (`castInvalidationWgsl.ts`).
 */
import { VSM_BOX_CULL_WGSL } from './boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_MARKS_GATHER_WGSL,
} from './pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_READ_WGSL, VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts'
import { vsmBindingsWgsl, type VsmBindingSpec } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { transformPoint } from '../../../math/src/wgsl/projection.ts'
import { wgslBlock, type WgslDecl } from '../../../math/src/wgsl/decl.ts'

/** Bytes of the stale's parameters (`VsmCastParams`). */
export const VSM_INVALIDATION_PARAMS_BYTES = 16

/** A box that bounds nothing finite reaches every page: as large an extent as f32 clip math keeps. */
export const UNBOUNDED_EXTENT = 1e15

/** Instance flags, the two the host knows of a box: it casts shadows (a valid instance), and it is
 *  cached as dynamic (the engine's box moving), else as static. */
export const VSM_BOX_CASTS = 1 << 0
export const VSM_BOX_MOVING = 1 << 1

/** Group 0: the previous frame's VSM state */
export const VSM_INVALIDATION_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0, prev: true, name: 'vsm' },
  { resource: 'projectionData', binding: 1, prev: true, name: 'vsmProjectionData' },
  { resource: 'pageMarks', binding: 2, prev: true, name: 'vsmPageMarks' },
  { resource: 'mappedRects', binding: 3, prev: true, name: 'vsmMappedRects' },
  {
    resource: 'pageRequests',
    binding: 4,
    prev: true,
    access: 'atomic',
    name: 'vsmPageRequests',
  },
]

/** The instance an invalidation stales the pages of, and its two flags. */
const VSM_INVALIDATION_INSTANCE_WGSL = wgslBlock(
  'VSM_INVALIDATION_INSTANCE_WGSL',
  [],
  `
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
${wgslConsts({ VSM_BOX_CASTS, VSM_BOX_MOVING })}
`,
)

/** Page-rect overlap and static caching (the box cull, its rect and the fine-caster test are the
 *  shared `VSM_BOX_CULL_WGSL`'s), then the stale of one instance's pages (`vsmStaleBoxPages`): what
 *  every invalidation entry runs over the previous frame's maps. */
const VSM_STALE_PAGES_WGSL = wgslBlock(
  'VSM_STALE_PAGES_WGSL',
  [VSM_INVALIDATION_INSTANCE_WGSL, VSM_BOX_CULL_WGSL, transformPoint],
  `
/** Clips the page rect of a pixel rect to the allocated bounds (at map id · 8 + mip). */
fn vsmMappedRectPages(pixels:vec4i,h:VsmHandle,mipLevel:u32)->vec4u{
 let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
 let i=h.id*VSM_MIPS+mipLevel;
 var bounds=vec4u(0xFFFFFFFFu,0xFFFFFFFFu,0u,0u);
 if(i<arrayLength(&vsmMappedRects)){bounds=vsmMappedRects[i];}
 return vec4u(max(pagesRect.xy,bounds.xy),min(pagesRect.zw,bounds.zw));
}
/** Whether an instance is cached as static: its view is cached and its box does not move. */
fn vsmCachesAsStatic(inst:VsmInvalidationInstance,viewUncached:bool)->bool{
 return !viewUncached&&(inst.flags&VSM_BOX_MOVING)==0u;
}

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
  shiftedCenter=transformPoint(localToShifted,inst.boxCentre);
  let r=pd.lightRange+boxRadius;
  if(dot(shiftedCenter,shiftedCenter)>r*r){return;}
 }
 // Back to clip space: uvToClip · shiftedToShadowUV.
 let uvToClip=mat4x4f(vec4f(2.0,0.0,0.0,0.0),vec4f(0.0,-2.0,0.0,0.0),vec4f(0.0,0.0,1.0,0.0),vec4f(-1.0,1.0,0.0,1.0));
 let isOrtho=sunMap;
 let nearClip=!sunMap;
 // The box to clip space through its local-to-world, then the view's world-to-clip.
 let toClip=uvToClip*pd.shiftedToMapUv;
 let boxPoint=vsmBoxCullPoint(inst.boxCentre,inst.boxExtent,isOrtho,nearClip);
 let cull=vsmBoxInView(toClip*(localToShifted*vec4f(boxPoint,1.0)),toClip*localToShifted[0],toClip*localToShifted[1],toClip*localToShifted[2],
  inst.boxExtent,pd.lightViewToClip,isOrtho,nearClip);
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
`,
)

/** An invalidation module over the previous frame's maps (group 0, `VSM_INVALIDATION_SPECS`): its own
 *  group 1 and entry point (`text`) with the declarations it names (`deps`), and the stale of an
 *  instance's pages they call (`vsmStaleBoxPages`). */
export function vsmInvalidationProgram(
  layout: VsmLayout,
  text: string,
  deps: readonly WgslDecl[] = [],
) {
  return wgslProgram(text, [
    ...deps,
    VSM_CONSTANTS_WGSL,
    VSM_HANDLE_WGSL,
    VSM_PAGE_ADDRESS_WGSL,
    VSM_PROJECTION_DATA_WGSL,
    vsmBindingsWgsl(0, VSM_INVALIDATION_SPECS, layout),
    VSM_PROJECTION_DATA_READ_WGSL,
    VSM_PAGE_MARKS_GATHER_WGSL,
    VSM_STALE_PAGES_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ])
}
