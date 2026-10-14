import { bitAt, bitIsSet, lowBits, rectCell } from '../../../math/src/wgsl/integer.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../gpu/dispatch/grid.ts'
import { VSM_CONSTANTS_WGSL } from './constants.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_MARKS_GATHER_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
} from './pageTableWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { VSM_RENDER_PARAMS_WGSL } from './renderParamsWgsl.ts'

/** THE NON-CLUSTER RASTER'S EXPAND (`renderCullWgsl.ts`): one workgroup a command, its pages marked
 *  and the raster's (row, page) pairs listed. */

/** Group 0 of `vsmRenderExpand`. */
export const VSM_RENDER_EXPAND_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'pageMarks', binding: 2 },
  { resource: 'rasterMarks', binding: 3, access: 'read_write' },
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
struct VsmRenderCommand{id:u32,mip:u32,staticLayer:bool,flatten:u32,rect:vec4u,corners:u32,markMask:u32,markBits:u32,}
fn vsmRenderCommandOf(cmd:vec4u)->VsmRenderCommand{
 return VsmRenderCommand(
  cmd.y&0xFFFFu,
  (cmd.y>>16u)&7u,
  bitIsSet(cmd.y,19u),
  bitAt(cmd.y,20u),
  vec4u(cmd.z&0x7Fu,(cmd.z>>7u)&0x7Fu,(cmd.z>>14u)&0x7Fu,(cmd.z>>21u)&0x7Fu),
  cmd.w&0xFFFFu,
  (cmd.w>>16u)&0xFFu,
  (cmd.w>>24u)&lowBits(VSM_DIRTY_SLICES));
}`,
)

/**
 * `vsmRenderExpand`: group 0 = `VSM_RENDER_EXPAND_SPECS`; group 1: 0 params, 1 commands, 2 counters
 * (rw atomic), 3 pairs (rw). One workgroup per command (2D wrapped), threads over its page rect.
 *
 * Pair (vec4u): x row; y VSM id | mip << 16 | clamp-to-near << 20 | pool slice << 21;
 * z virtual page x | y << 8; w physical page address x | y << 10.
 */
export const vsmRenderExpandWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
@group(1) @binding(3) var<storage,read_write> pairs:array<vec4u>;
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
 if(index>=vsmRenderCommandCount()){return;}
 let cmd=cmds[index];
 let c=vsmRenderCommandOf(cmd);
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
   let at=atomicAdd(&counts[vsmRenderChunkCounter(params.chunk,1u)],1u);
   if(at<params.pairCapacity){
    pairs[at]=vec4u(cmd.x,c.id|(c.mip<<16u)|(c.flatten<<20u)|(slice<<21u),vPage.x|(vPage.y<<8u),page.physicalAddress.x|(page.physicalAddress.y<<10u));
    atomicMax(&counts[vsmRenderChunkCounter(params.chunk,2u)],c.corners);
   }
  }
 }
}
`,
    [
      VSM_CONSTANTS_WGSL,
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      vsmBindingsWgsl(0, VSM_RENDER_EXPAND_SPECS, layout),
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PAGE_MARKS_GATHER_WGSL,
      VSM_RENDER_COMMAND_WGSL,
      FLAT_INDEX_WGSL,
      WORKGROUP_THREADS_WGSL,
      rectCell,
    ],
  )
