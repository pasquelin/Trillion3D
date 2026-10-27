import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
} from '../pageTableWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import {
  VSM_RENDER_PARAMS_WGSL,
  VSM_RENDER_RECORD_WGSL,
  VSM_RENDER_SOFTWARE_COUNTS_WGSL,
} from './renderParamsWgsl.ts'

/** THE SHADOW RASTER'S BIN (`renderCullWgsl.ts`): a thread a record the cull emitted, placed among
 *  its bin's — the raster's bins, one draw each —, as the reference scatters its visible clusters
 *  into their raster bins, and the pages of its window it draws marked
 *  drawn. */

/** Group 0 of `vsmRenderBin`. */
export const VSM_RENDER_BIN_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'rasterMarks', binding: 2, access: 'read_write' },
  // Where each map's table lies (`vsmTableLevelOrigin`).
  { resource: 'projectionData', binding: 3 },
]

const binHelpersText = /* wgsl */ `@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(2) var<storage,read> records:array<vec4u>;
@group(1) @binding(3) var<storage,read_write> sorted:array<vec4u>;
/** The raster marks a drawn page takes: its static or dynamic drawn bit; where the caster invalidates
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
}`

const binKernelText = /* wgsl */ `
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderBin(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(index>=vsmRenderRecordTotal(atomicLoad(&counts[VSM_RENDER_COUNT_RECORDS]))){return;}
 let r=records[index];
 // The pages of the window it draws, marked drawn: those whose flags hold its layer.
 let mip=vsmRecordMip(r);
 let levelOffset=vsmTableLevelOrigin(vsmHandleFromId(vsmRecordMap(r)),mip);
 let first=vsmRecordFirstPage(r);
 // A software record's one page translated here, once for its cluster (a one-page window): its table word in place of its mask (\`renderSoftwareWgsl.ts\`); the software
 // records' counts, the dynamic layer's and the static layer's, at the capacity's place.
 var placed=r;
 if(vsmRecordSoftware(r)){placed.w=vsmTableWord(vsmTableEntryAt(levelOffset,mip,first));}
 sorted[atomicAdd(&counts[VSM_RENDER_TIER_CURSOR+vsmRecordTier(r)],1u)]=placed;
 if(index==0u){sorted[params.recordCapacity]=vec4u(vsmRenderSoftwareCounts(vsmRenderRecordTotal(atomicLoad(&counts[VSM_RENDER_COUNT_RECORDS]))),0u,0u);}
 let markBits=vsmRasterMarkBits(vsmRecordStatic(r)!=0u,vsmRecordDeforms(r),vsmRecordOffsetAllowed(r),vsmRecordLodBehind(r));
 var mask=r.w;
 loop{
  if(mask==0u){break;}
  let bit=firstTrailingBit(mask);
  mask&=mask-1u;
  let page=first+vec2u(bit%VSM_RENDER_WINDOW_PAGES,bit/VSM_RENDER_WINDOW_PAGES);
  vsmMarkDrawnPage(vsmTableEntryAtOffset(vsmTableEntryAt(levelOffset,mip,page)),markBits);
 }
}`

/**
 * `vsmRenderBin`: group 0 = `VSM_RENDER_BIN_SPECS`; group 1: 0 params, 1 counters (rw atomic),
 * 2 records (the cull's), 3 the records sorted by tier (rw), the software records first and their
 * count at the capacity's place. The argument kernel set each tier's cursor at its first place
 * (`vsmRenderArgsBin`).
 */
export const vsmRenderBinWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${binHelpersText}${binKernelText}
`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      vsmBindingsWgsl(0, VSM_RENDER_BIN_SPECS, layout),
      VSM_PAGE_LOOKUP_WGSL,
      VSM_RENDER_PARAMS_WGSL,
      VSM_RENDER_RECORD_WGSL,
      VSM_RENDER_SOFTWARE_COUNTS_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
    ],
  )
