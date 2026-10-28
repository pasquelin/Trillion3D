import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslVariants } from '../../../../../../math/src/wgsl/decl.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../../gpu/dispatch/grid.ts'
import { SUBGROUP_ALL_WGSL } from '../../../../gpu/core/subgroups.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { vsmBoxCullBlock } from '../invalidation/boxCullWgsl.ts'
import { VSM_PAGE_MARKS_GATHER_WGSL } from '../pageGatherWgsl.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
} from '../pageTableWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'
import { VSM_RASTER_MARKS_WGSL } from './renderCullWgsl.ts'
import {
  VSM_RENDER_PARAMS_WGSL,
  VSM_RENDER_RECORD_WGSL,
  VSM_RENDER_SOFTWARE_COUNTS_WGSL,
  VSM_RENDER_SOFTWARE_VIEWS_WGSL,
} from './renderParamsWgsl.ts'

/** THE SHADOW RASTER'S BIN (`renderCullWgsl.ts`): a thread a record the cull emitted, placed among
 *  its bin's — the raster's bins, one draw each —, as the reference scatters its visible clusters
 *  into their raster bins, and the page table put in the record: the index of the first page of its
 *  window, which both rasters read the window's pages from (the software raster into its group's
 *  memory, as the reference's does). The pages of its rect that the cull matched are marked drawn by
 *  the cull, as the reference's cull marks a page it keeps (`vsmCullMarks`); on a device with fewer
 *  storage buffers a stage than that asks, by the bin — those the record's marks match, no other. A bin's places are taken a subgroup at a time where the device has subgroups — one counter
 *  add a bin and subgroup, the places of its lanes after it by an exclusive sum — and a workgroup at
 *  a time without (`vsmBinPlace`): the same places, the order of a bin's records apart. Where the
 *  software raster does not bind the projection data (`vsmViewsLaid`), the entry `vsmRenderLayViews`
 *  lays the view of each map of the pass for it (`vsmLayView`): a thread a map. */

/** Group 0 of `vsmRenderBin` where the bin marks the pages drawn. */
export const VSM_RENDER_BIN_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'rasterMarks', binding: 2, access: 'read_write' },
  // Where each map's table lies (`vsmTableLevelOrigin`).
  { resource: 'projectionData', binding: 3 },
  // The pages' marks the cull matched its windows by.
  { resource: 'pageMarks', binding: 4 },
]

/** Group 0 of `vsmRenderBin` where the cull marks the pages drawn (`vsmCullMarks`): the uniforms and the
 *  table origins alone. */
const VSM_RENDER_BIN_UNMARKING_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'projectionData', binding: 3 },
]

/** Group 0 of `vsmRenderBin`, by whether the cull marks the pages drawn (`marks`). */
export const vsmRenderBinSpecs = (marks: boolean) =>
  marks ? VSM_RENDER_BIN_UNMARKING_SPECS : VSM_RENDER_BIN_SPECS

/** The marks a record's window was matched by (`vsmRecordMarkWanted`, `vsmRecordMarkPrimary`): the
 *  mask the cull matched its pages by, which a page's marks satisfy (`vsmRecordMarksMatch`). */
export const binMarksWgsl = wgslVariants((prefiltered: boolean) =>
  wgslBlock(
    prefiltered ? 'VSM_BIN_MARKS_PREFILTERED_WGSL' : 'VSM_BIN_MARKS_WGSL',
    [VSM_CONSTANTS_WGSL, VSM_RENDER_RECORD_WGSL],
    /* wgsl */ `fn vsmRecordMarkMask(r:vec4u)->u32{
 var mask=select(select(VSM_PAGE_DYNAMIC_STALE,VSM_PAGE_STATIC_STALE,vsmRecordStatic(r)!=0u),VSM_PAGE_WANTED,vsmRecordMarkWanted(r));
 ${prefiltered ? 'if(vsmRecordMarkPrimary(r)){mask|=VSM_PAGE_PRIMARY;}' : ''}
 return mask;
}`,
  ),
)

/** A record's place among its bin's: the bin of each lane of the group, its place the bin's cursor
 *  advanced by the lanes before it that hold the same bin. `valid` is the lane's holding a record;
 *  every lane of the group calls it. */
const BIN_PLACE_SUBGROUPS = /* wgsl */ `
fn vsmBinPlace(tier:u32,valid:bool,lane:u32)->u32{
 var pending=valid;
 var place=0u;
 loop{
  if(!subgroupAny(pending)){break;}
  // The least bin the subgroup's pending lanes hold: its lanes take their places together.
  let bin=subgroupMin(select(0xFFFFFFFFu,tier,pending));
  let same=select(0u,1u,pending&&tier==bin);
  let before=subgroupExclusiveAdd(same);
  let count=subgroupAdd(same);
  var base=0u;
  if(subgroupElect()){base=atomicAdd(&counts[VSM_RENDER_TIER_CURSOR+bin],count);}
  base=subgroupBroadcastFirst(base);
  if(same==1u){place=base+before;pending=false;}
 }
 return place;
}`

const BIN_PLACE_WORKGROUP = /* wgsl */ `
var<workgroup> binTotal:array<atomic<u32>,VSM_RENDER_BINS>;
var<workgroup> binBase:array<u32,VSM_RENDER_BINS>;
fn vsmBinPlace(tier:u32,valid:bool,lane:u32)->u32{
 var rank=0u;
 if(valid){rank=atomicAdd(&binTotal[tier],1u);}
 workgroupBarrier();
 if(lane<VSM_RENDER_BINS){
  let n=atomicLoad(&binTotal[lane]);
  if(n>0u){binBase[lane]=atomicAdd(&counts[VSM_RENDER_TIER_CURSOR+lane],n);}
 }
 workgroupBarrier();
 return binBase[tier]+rank;
}`

const binHelpersText = (
  prefiltered: boolean,
  subgroups: boolean,
  marks: boolean,
) => /* wgsl */ `@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read_write> counts:array<atomic<u32>>;
@group(1) @binding(2) var<storage,read> records:array<vec4u>;
@group(1) @binding(3) var<storage,read_write> sorted:array<vec4u>;
${subgroups ? BIN_PLACE_SUBGROUPS : BIN_PLACE_WORKGROUP}
/** The view of map \`map\` of the pass laid in the sorted list for the software raster
 *  (\`vsmSoftwareViewAt\`), a record at a time. */
fn vsmLayView(map:u32){
 let view=vsmPackView(vsmProjectionData[map]);
 let at=vsmSoftwareViewAt(map);
 for(var k=0u;k<VSM_RENDER_SOFTWARE_VIEW_RECORDS;k++){sorted[at+k]=view[k];}
}`

/** The marks of the pages of a record's rect the cull matched, by the bin that places it: those the raster draws
 *  into. */
const BIN_MARKS_TEXT = /* wgsl */ `
 let markBits=vsmRasterMarkBits(vsmRecordStatic(r)!=0u,vsmRecordDeforms(r),vsmRecordOffsetAllowed(r),vsmRecordLodBehind(r));
 let mask=vsmRecordMarkMask(r);
 let last=vsmRecordLastPage(r);
 for(var y=first.y;y<=last.y;y++){
  for(var x=first.x;x<=last.x;x++){
   let cell=vsmTableEntryAt(levelOffset,mip,vec2u(x,y));
   if(vsmRecordMarksMatch(vsmPageMarkWord(cell),mask)){vsmMarkDrawnPage(vsmTableEntryAtOffset(cell),markBits);}
  }
 }`

const binKernelText = (marks: boolean) => /* wgsl */ `
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderBin(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 let total=vsmRenderRecordTotal(atomicLoad(&counts[VSM_RENDER_COUNT_RECORDS]));
 let valid=index<total;
 var r=vec4u(0u);
 if(valid){r=records[index];}
 let place=vsmBinPlace(vsmRecordTier(r),valid,lane);
 if(!valid){return;}
 let mip=vsmRecordMip(r);
 let levelOffset=vsmTableLevelOrigin(vsmHandleFromId(vsmRecordMap(r)),mip);
 let first=vsmRecordFirstPage(r);
 // The page table put in the record (\`w\`): the index of its window's first page, whichever raster
 // draws it.
 var placed=r;
 placed.w=vsmTableIndex(vsmTableEntryAt(levelOffset,mip,first).tableXY);
 sorted[place]=placed;
 if(index==0u){sorted[params.recordCapacity]=vec4u(vsmRenderSoftwareCounts(total),0u,0u);}${marks ? '' : BIN_MARKS_TEXT}
}
/** The view of each map of the pass, a thread a map (\`vsmLayView\`). */
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderLayViews(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(index<params.viewCount){vsmLayView(params.viewFirst+index);}
}`

/**
 * `vsmRenderBin`: group 0 = `vsmRenderBinSpecs(marks)`; group 1: 0 params, 1 counters (rw atomic),
 * 2 records (the cull's), 3 the records sorted by tier (rw), the software records first, their
 * count at the capacity's place and, where the views are laid (`vsmViewsLaid`), the views of the
 * pass's maps after it. The argument kernel set each tier's cursor at its first place and the
 * dispatch over the records (`vsmRenderArgsBin`); `subgroups`: the device's, which place a bin's
 * records a subgroup at a time; `marks`: the cull marks the pages drawn (`vsmCullMarks`), the bin
 * marks none.
 */
export const vsmRenderBinWgsl = (layout: VsmLayout, subgroups = false, marks = false) =>
  wgslProgram(
    /* wgsl */ `
${binHelpersText(layout.prefilteredDistant, subgroups, marks)}${binKernelText(marks)}
`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      vsmBindingsWgsl(0, vsmRenderBinSpecs(marks), layout),
      ...(marks
        ? []
        : [
            binMarksWgsl(layout.prefilteredDistant),
            VSM_PAGE_LOOKUP_WGSL,
            VSM_PAGE_MARKS_GATHER_WGSL,
            vsmBoxCullBlock(layout.prefilteredDistant),
            VSM_RASTER_MARKS_WGSL,
          ]),
      VSM_RENDER_PARAMS_WGSL,
      VSM_RENDER_RECORD_WGSL,
      VSM_RENDER_SOFTWARE_COUNTS_WGSL,
      VSM_RENDER_SOFTWARE_VIEWS_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      ...(subgroups ? [SUBGROUP_ALL_WGSL] : []),
    ],
  )
