import { VSM_PAGE_MARKS_GATHER_WGSL } from '../pageGatherWgsl.ts'
import { bitAt, bitIsSet, lowBits, rectCell } from '../../../../../../math/src/wgsl/integer.ts'
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
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'

/** THE NON-CLUSTER RASTER'S EXPAND (`renderCullWgsl.ts`): one workgroup a command, its pages marked
 *  and the raster's (row, page) pairs listed. */

/** Group 0 of `vsmRenderExpand`. */
export const VSM_RENDER_EXPAND_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'pageMarks', binding: 2 },
  { resource: 'rasterMarks', binding: 3, access: 'read_write' },
  // Where each map's table lies (`vsmTableLevelOrigin`).
  { resource: 'projectionData', binding: 4 },
]

/**
 * What the expand and the transmission's page list read of a chunk's commands — group 1: 0 params,
 * 1 commands, 2 counters (rw atomic) —, and a command's words decoded (`vsmRenderCullWgsl`).
 */
export const VSM_RENDER_COMMAND_WGSL = wgslBlock(
  'VSM_RENDER_COMMAND_WGSL',
  [VSM_CONSTANTS_WGSL, VSM_RENDER_PARAMS_WGSL, bitAt, bitIsSet, lowBits],
  `
@group(1) @binding(0) var<uniform> params:VsmRenderParams;
@group(1) @binding(1) var<storage,read> cmds:array<vec4u>;
@group(1) @binding(2) var<storage,read_write> counts:array<atomic<u32>>;
/** The chunk's commands, as many as it holds. */
fn vsmRenderCommandCount()->u32{return min(atomicLoad(&counts[vsmRenderChunkCounter(params.chunk,0u)]),params.cmdCapacity);}
struct VsmRenderCommand{id:u32,mip:u32,staticLayer:bool,flatten:u32,swapped:u32,rect:vec4u,corners:u32,markMask:u32,markBits:u32,}
fn vsmRenderCommandOf(cmd:vec4u)->VsmRenderCommand{
 return VsmRenderCommand(
  cmd.y&0xFFFFu,
  (cmd.y>>16u)&7u,
  bitIsSet(cmd.y,19u),
  bitAt(cmd.y,20u),
  bitAt(cmd.y,21u),
  vec4u(cmd.z&0x7Fu,(cmd.z>>7u)&0x7Fu,(cmd.z>>14u)&0x7Fu,(cmd.z>>21u)&0x7Fu),
  cmd.w&0xFFFFu,
  (cmd.w>>16u)&0xFFu,
  (cmd.w>>24u)&lowBits(VSM_DIRTY_SLICES));
}`,
)

/**
 * `vsmRenderBin` and `vsmRenderExpand`: group 0 = `VSM_RENDER_EXPAND_SPECS`; group 1: 0 params,
 * 1 commands, 2 counters (rw atomic), 3 pairs (rw), 4 the tiers' order (rw).
 *
 * The bin, a thread a command: its place among its tier's commands (the cull counted them, the
 * argument kernel set each tier's cursor at its first), the commands of a tier then following the
 * lower tiers' in the order. The expand, once a tier (`VSM_RENDER_TIER`, an override), lowest
 * first, a workgroup per command of the tier (2D wrapped), threads over its page rect: a tier's
 * pairs follow the lower tiers' in the list and draw by their tier's corners (`vsmRenderArgsDraw`).
 *
 * Pair (vec4u): x row; y VSM id | mip << 16 | clamp-to-near << 20 | pool slice << 21 | swapped
 * << 22 (`vsmRenderVs`); z virtual page x | y << 8; w physical page address x | y << 10.
 */
export const vsmRenderExpandWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
override VSM_RENDER_TIER:u32=0u;
@group(1) @binding(3) var<storage,read_write> pairs:array<vec4u>;
@group(1) @binding(4) var<storage,read_write> order:array<u32>;
fn vsmRenderTierCounter(word:u32,tier:u32)->u32{return vsmRenderChunkCounter(params.chunk,word+tier);}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderBin(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u)*WORKGROUP_THREADS+lane;
 if(index>=vsmRenderCommandCount()){return;}
 let tier=vsmRenderTierOf(vsmRenderCommandOf(cmds[index]).corners);
 order[atomicAdd(&counts[vsmRenderTierCounter(VSM_RENDER_TIER_CURSOR,tier)],1u)]=index;
}
/** Marks a physical page dirty. */
fn vsmMarkDrawnPage(page:VsmTableEntry,markBits:u32){
 if(!page.thisLevelMapped){return;}
 let drawnPool=vsmPoolIndexOf(page.physicalAddress);
 let n=vsm.poolPages;
 for(var s=0u;s<VSM_DIRTY_SLICES;s++){
  if((markBits&(1u<<s))!=0u){vsmRasterMarksStore(n*s+drawnPool,1u);}
 }
}
@compute @workgroup_size(WORKGROUP_THREADS) fn vsmRenderExpand(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u);
 let tierCmds=atomicLoad(&counts[vsmRenderTierCounter(VSM_RENDER_TIER_CMDS,VSM_RENDER_TIER)]);
 if(index>=tierCmds){return;}
 // The tier's commands end at its cursor, the bin done.
 let cmd=cmds[order[atomicLoad(&counts[vsmRenderTierCounter(VSM_RENDER_TIER_CURSOR,VSM_RENDER_TIER)])-tierCmds+index]];
 let c=vsmRenderCommandOf(cmd);
 // The lower tiers' pairs, all listed by their passes before this one.
 var first=0u;
 for(var t=0u;t<VSM_RENDER_TIER;t++){first+=atomicLoad(&counts[vsmRenderTierCounter(VSM_RENDER_TIER_PAIRS,t)]);}
 let h=vsmHandleFromId(c.id);
 let levelOffset=vsmTableLevelOrigin(h,c.mip);
 let size=(c.rect.zw+vec2u(1u))-c.rect.xy;
 // The pool slice the raster writes: the static slice for a static-cached instance.
 let slice=select(0u,vsm.staticSlice,c.staticLayer);
 for(var i=lane;i<size.x*size.y;i+=WORKGROUP_THREADS){
  let vPage=rectCell(c.rect,size,i);
  let offset=vsmTableEntryAt(levelOffset,c.mip,vPage);
  let page=vsmTableEntryAtOffset(offset);
  // The instance's own layer of this page is uncached: its static slice for a static instance, its
  // dynamic slice for a dynamic one (the cull's mark mask).
  let layerStale=(vsmPageMarkWord(offset)&c.markMask)!=0u;
  // Mark the page dirty: pages whose flags carry the instance's mask.
  if(layerStale){vsmMarkDrawnPage(page,c.markBits);}
  // The raster's page: valid for rendering, and its layer uncached. A static instance is never
  // redrawn into a cached static slice (a page stale in its dynamic layer alone, as the sun's receiver
  // mask makes every requested page each frame): its depth is already there, not merged (no
  // static drawn mark) and slice 0, which the projection reads, was initialized from it.
  if(page.thisLevelDrawable&&layerStale){
   let at=first+atomicAdd(&counts[vsmRenderTierCounter(VSM_RENDER_TIER_PAIRS,VSM_RENDER_TIER)],1u);
   if(at<params.pairCapacity){
    pairs[at]=vec4u(cmd.x,c.id|(c.mip<<16u)|(c.flatten<<20u)|(slice<<21u)|(c.swapped<<22u),vPage.x|(vPage.y<<8u),page.physicalAddress.x|(page.physicalAddress.y<<10u));
   }
  }
 }
}
`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      VSM_TABLE_ORIGIN_WGSL,
      vsmBindingsWgsl(0, VSM_RENDER_EXPAND_SPECS, layout),
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PAGE_MARKS_GATHER_WGSL,
      VSM_RENDER_COMMAND_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      rectCell,
    ],
  )
