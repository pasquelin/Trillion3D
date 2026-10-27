import { VSM_PAGE_MARKS_GATHER_WGSL } from './pageGatherWgsl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
/**
 * Cache invalidation shaders (step 7): the load-balanced instance-page invalidation, with the
 * helpers it needs (frustum box cull, screen rect, mip level of a rect — the render cull's, from
 * `invalidation/boxCullWgsl.ts` —, page overlap, page cache).
 *
 * Everything reads the PREVIOUS frame's VSM state: `vsm` = prev uniforms, prev projection data,
 * prev page marks, prev allocated page rect bounds; the invalidation bits are OR'ed into the prev
 * page requests, which the pool's page carry (step 4) folds into the pool page info.
 *
 * An instance (`VsmInvalidationInstance`) is an oriented world box and one flag (cached as dynamic): its
 * centre and its three half axes, and what says whether its offset puts it in the dynamic layer of a
 * map (`vsmCachesAsStatic`). The one entry that builds them is
 * the shadow changes' (`invalidation/castInvalidationWgsl.ts`), from the list's records.
 */
import { MOBILITY_OFFSET_ALWAYS, MOBILITY_OFFSET_INVALIDATES } from '../mobilityBits.ts'
import { VSM_BOX_CULL_WGSL, VSM_OFFSET_GROWS_WGSL } from './invalidation/boxCullWgsl.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import { VSM_HANDLE_WGSL, VSM_PAGE_ADDRESS_WGSL, VSM_TABLE_ORIGIN_WGSL } from './pageTableWgsl.ts'
import {
  VSM_PROJECTION_DATA_READ_WGSL,
  VSM_PROJECTION_DATA_WGSL,
} from './projection/projectionDataWgsl.ts'
import { vsmBindingsWgsl, type VsmBindingSpec } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'

/** The instance flag: its box is cached as dynamic (its casters already moving), else as static. */
const VSM_BOX_MOVING = 1

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

/** The oriented world box an invalidation stales the pages of, and its flag. */
const VSM_INVALIDATION_INSTANCE_WGSL = wgslBlock(
  'VSM_INVALIDATION_INSTANCE_WGSL',
  [],
  `
struct VsmInvalidationInstance{centre:vec3f,flags:u32,axisX:vec3f,views:u32,axisY:vec3f,offsetBits:u32,axisZ:vec3f,offsetDisableSq:f32,}
${wgslConsts({ VSM_BOX_MOVING, MOBILITY_OFFSET_ALWAYS, MOBILITY_OFFSET_INVALIDATES })}
`,
)

/** Page-rect overlap and static caching (the box cull, its rect and the fine-caster test are the
 *  shared `VSM_BOX_CULL_WGSL`'s), then the stale of one instance's pages (`vsmStaleBoxPages`): what
 *  every invalidation entry runs over the previous frame's maps. */
const VSM_STALE_PAGES_WGSL = wgslBlock(
  'VSM_STALE_PAGES_WGSL',
  [
    VSM_INVALIDATION_INSTANCE_WGSL,
    VSM_BOX_CULL_WGSL,
    VSM_OFFSET_GROWS_WGSL,
    VSM_PROJECTION_DATA_READ_WGSL,
  ],
  `
/** A page rect that holds no page: its first corner past its last. */
const VSM_EMPTY_PAGE_RECT:vec4u=vec4u(0xffffffffu,0xffffffffu,0u,0u);
/** Clips the page rect of a pixel rect to the allocated bounds (at map id · 8 + mip). */
fn vsmMappedRectPages(pixels:vec4i,h:VsmHandle,mipLevel:u32)->vec4u{
 let pagesRect=vec4u(pixels)>>vec4u(VSM_LOG2_PAGE);
 let i=h.id*VSM_MIPS+mipLevel;
 var bounds=VSM_EMPTY_PAGE_RECT;
 if(i<arrayLength(&vsmMappedRects)){bounds=vsmMappedRects[i];}
 return vec4u(max(pagesRect.xy,bounds.xy),min(pagesRect.zw,bounds.zw));
}
/** Whether an instance's offset is allowed in a map: its placement's offset invalidates its shadows,
 *  and a surface always evaluates it or the map's level is not past the distance its object stops at. */
fn vsmOffsetAllowed(inst:VsmInvalidationInstance,pd:VsmProjectionData)->bool{
 return vsmOffsetGrows((inst.offsetBits&MOBILITY_OFFSET_INVALIDATES)!=0u,(inst.offsetBits&MOBILITY_OFFSET_ALWAYS)!=0u,inst.offsetDisableSq,pd.wpoThreshold);
}
/** Whether an instance is cached as static in a map: its view is cached, its box does not move, and
 *  its offset is not allowed there. */
fn vsmCachesAsStatic(inst:VsmInvalidationInstance,pd:VsmProjectionData)->bool{
 return !pd.uncached&&(inst.flags&VSM_BOX_MOVING)==0u&&!vsmOffsetAllowed(inst,pd);
}

fn vsmMarkStale(o:VsmTableCell,flags:u32){
 let i=vsmTableIndex(o.tableXY);
 if(i<arrayLength(&vsmPageRequests)){atomicOr(&vsmPageRequests[i],flags);}
}
/** Invalidates the pages of one instance. */
fn vsmStaleBoxPages(pd:VsmProjectionData,inst:VsmInvalidationInstance){
 // A box staled in some views' maps alone (an instance whose cache state turned there).
 if(((inst.views>>pd.viewSlot)&1u)==0u){return;}
 // A map over a receiver cover draws its dynamic layer again each frame: a box cached as dynamic in it stales nothing.
 let staticBox=vsmCachesAsStatic(inst,pd);
 if(pd.useCover&&!staticBox){return;}
 let sunMap=pd.lightKind==LIGHT_KIND_DIRECTIONAL;
 // The box's centre in the shadow view's shifted space (the origin shift split high and low).
 let translation=(inst.centre+pd.originShiftHigh)+pd.originShiftLow;
 // Its half axes and that translation, as a matrix carrying the unit box (extent one) to the oriented
 // one.
 let localToShifted=mat4x4f(
  vec4f(inst.axisX,0.0),
  vec4f(inst.axisY,0.0),
  vec4f(inst.axisZ,0.0),
  vec4f(translation,1.0));
 let unitExtent=vec3f(1.0);
 // The radius of the box's bounding sphere: the length of its extents scaled by its axes' lengths.
 let boxRadius=sqrt(dot(inst.axisX,inst.axisX)+dot(inst.axisY,inst.axisY)+dot(inst.axisZ,inst.axisZ));
 // Distance cull for local lights, on the bounds' shifted centre — the translation itself: its
 // product with the matrix differs from it in a zero's sign alone, which a length cannot see.
 let shiftedCenter=translation;
 if(!sunMap){
  let r=pd.lightRange+boxRadius;
  if(dot(shiftedCenter,shiftedCenter)>r*r){return;}
 }
 let isOrtho=sunMap;
 let nearClip=!sunMap;
 // The box to clip space through its local-to-shifted, then the view's shifted-to-clip.
 let toClip=vsmShiftedToClip(pd.shiftedToMapUv);
 let boxPoint=vsmBoxCullPoint(vec3f(0.0),unitExtent,isOrtho,nearClip);
 let cull=vsmBoxInView(toClip*(localToShifted*vec4f(boxPoint,1.0)),toClip*localToShifted[0],toClip*localToShifted[1],toClip*localToShifted[2],
  unitExtent,pd.lightViewToClip,isOrtho,nearClip);
 var pixelRadius=vsmClipRadius(isOrtho,boxRadius,shiftedCenter,pd.lightViewToClip)*f32(VSM_LEVEL0_TEXELS);
 if(!cull.inMapView){return;}
 // A map of one page (a distant light's: its last mip alone) has that page's static layer staled and
 // is done. Over a receiver cover only a box cached as static reaches here (a dynamic one returned
 // above); without a cover a box of either layer does.
 if(pd.distant){
  let lastMip=VSM_MIPS-1u;
  vsmMarkStale(vsmTableEntryAt(vsmTableLevelOrigin(pd.handle,lastMip),lastMip,vec2u(0u,0u)),VSM_META_STATIC_STALE);
  return;
 }
 let staleBits=select(VSM_META_DYNAMIC_STALE,VSM_META_STATIC_STALE,staticBox);
 let staleStatic=(staleBits&VSM_META_STATIC_STALE)!=0u;
 let mipCount=select(1,i32(VSM_MIPS),pd.levelsLeft<=0);
 for(var mipLevel=i32(pd.finestMip);mipLevel<mipCount;mipLevel++){
  let mip=u32(mipLevel);
  let mapTexels=i32(VSM_LEVEL0_TEXELS>>mip);
  let pixels=vsmRectPixels(vec4i(0,0,mapTexels,mapTexels),cull);
  // All allocated pages, cached or not, referenced this frame or not.
  let pagesRect=vsmMappedRectPages(pixels,pd.handle,mip);
  // A fine caster is looked for in fine pages alone, in the rect's hierarchical test; then any
  // allocated page of the rect is staled, but for the coarse pages of a map whose coarse pages keep
  // their dynamic layer, which a mover's box leaves.
  let fineRect=vsmIsFineCaster(staleStatic,pixelRadius);
  pixelRadius*=0.5;
  // Hierarchical test: skip areas without any allocated page.
  if(vsmTouchesMappedPage(pd.handle,mip,pagesRect,VSM_PAGE_WANTED,fineRect)){
   let hzbRect=vsmHzbRectOf(cull,mapTexels);
   let levelOffset=vsmTableLevelOrigin(pd.handle,mip);
   let wantedBits=VSM_PAGE_WANTED|select(0u,VSM_PAGE_FINE,pd.coarseDynamicCached&&!staleStatic);
   for(var y=pagesRect.y;y<=pagesRect.w;y++){
    for(var x=pagesRect.x;x<=pagesRect.z;x++){
     let markCell=vsmTableEntryAt(levelOffset,mip,vec2u(x,y));
     let pageMarks=vsmPageMarkWord(markCell);
     // Every page the map holds, requested last frame or not.
     // A page the box is hidden on, in the previous frame's depth pyramid, keeps its cache.
     if((pageMarks&wantedBits)==wantedBits&&vsmHzbPageSeen(pd.handle,mip,hzbRect,x,y)){
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

/** The stale of an instance's pages tests no page against a depth pyramid: its hooks
 *  (\`vsmHzbRectOf\`, \`vsmHzbPageSeen\`) always see the page. A module that does gives its own
 *  (\`invalidation/hzbWgsl.ts\`). */
export const VSM_NO_HZB_WGSL = wgslBlock(
  'VSM_NO_HZB_WGSL',
  [],
  `
struct VsmHzbRect{unused:u32,}
fn vsmHzbRectOf(cull:VsmBoxInView,mapTexels:i32)->VsmHzbRect{return VsmHzbRect(0u);}
fn vsmHzbPageSeen(h:VsmHandle,mipLevel:u32,r:VsmHzbRect,x:u32,y:u32)->bool{return true;}
`,
)

/** An invalidation module over the previous frame's maps (group 0, `VSM_INVALIDATION_SPECS`): its
 *  own group 1 and entry point (`text`) with the declarations it names (`deps`), and the stale of
 *  an instance's pages they call (`vsmStaleBoxPages`), which asks the module's hooks
 *  (\`vsmHzbRectOf\`, \`vsmHzbPageSeen\`: \`VSM_NO_HZB_WGSL\` or the pyramid's) whether a page is seen. */
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
    VSM_TABLE_ORIGIN_WGSL,
    VSM_PROJECTION_DATA_WGSL,
    vsmBindingsWgsl(0, VSM_INVALIDATION_SPECS, layout),
    VSM_PROJECTION_DATA_READ_WGSL,
    VSM_PAGE_MARKS_GATHER_WGSL,
    VSM_STALE_PAGES_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
  ])
}
