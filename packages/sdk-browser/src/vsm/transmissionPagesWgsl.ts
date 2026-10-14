import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { NO_INDEX } from '../../../math/src/constants.ts'
import { rectCell } from '../../../math/src/wgsl/integer.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_MARKS_GATHER_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
} from './pageTableWgsl.ts'
import { VSM_RENDER_COMMAND_WGSL } from './renderExpandWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from './resources.ts'
import type { VsmLayout } from './layout.ts'
import { VSM_T_COMMAND_GROUP_WGSL, frameWgsl } from './transmissionShared.ts'

/** Group 0 of `vsmTransmissionPages`: the VSM uniforms, page table and page marks. */
export const VSM_TRANSMISSION_PAGES_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'pageTable', binding: 1 },
  { resource: 'pageMarks', binding: 2 },
]

/**
 * `vsmTransmissionPages`, one group per command of the chunk's cull (the shared expand's dispatch,
 * `vsmRenderArgsExpand`): the pages of its rect the expand would pair (valid for rendering, the
 * command's layer uncached) whose slice the clear stamped, counted in the group, reserved at once
 * in the chunk's page list (its pair counter), then listed as (slice key, virtual page) after the
 * headers; the command's header (row, map | mip | flags, first page, page count) at its own slot,
 * an empty one for a slot past the chunk's commands. Group 0: `VSM_TRANSMISSION_PAGES_SPECS`;
 * group 1: 0 params (dynamic), 1 commands, 2 render counters, 3 the page list, 4 build buffer,
 * 5 frame uniform.
 */
export const vsmTransmissionPagesWgsl = (layout: VsmLayout) =>
  wgslProgram(
    `
@group(1) @binding(3) var<storage,read_write> list:array<u32>;
@group(1) @binding(4) var<storage,read> build:array<u32>;
@group(1) @binding(5) var<uniform> frame:VsmTransmissionFrame;
var<workgroup> wgCommands:u32;
var<workgroup> wgFound:atomic<u32>;
var<workgroup> wgBase:u32;
fn vsmTHeader(index:u32,h:vec4u){list[4u*index]=h.x;list[4u*index+1u]=h.y;list[4u*index+2u]=h.z;list[4u*index+3u]=h.w;}
/** Page \`i\` of the rect's slice key when the command's triangles go there this frame, else none. */
fn vsmTPageKey(levelOffset:VsmTableLevel,mip:u32,vPage:vec2u,markMask:u32,slice:u32)->u32{
 let offset=vsmTableEntryAt(levelOffset,mip,vPage);
 let page=vsmTableEntryAtOffset(offset);
 if(!page.thisLevelDrawable||(vsmPageMarkWord(offset)&markMask)==0u){return ${NO_INDEX}u;}
 let key=2u*(page.physicalAddress.y*${layout.poolPagesXY[0]}u+page.physicalAddress.x)+(slice&1u);
 if(build[VSM_T_STAMPS+key]!=frame.stamp){return ${NO_INDEX}u;}
 return key;
}
@compute @workgroup_size(VSM_T_COMMAND_GROUP) fn vsmTransmissionPages(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u);
 if(index>=frame.cmds){return;}
 if(lane==0u){
  wgCommands=vsmRenderCommandCount();
  atomicStore(&wgFound,0u);
 }
 if(index>=workgroupUniformLoad(&wgCommands)){
  if(lane==0u){vsmTHeader(index,vec4u(0u));}
  return;
 }
 let cmd=cmds[index];
 let c=vsmRenderCommandOf(cmd);
 let levelOffset=vsmTableLevelOrigin(vsmHandleFromId(c.id),c.mip);
 let size=(c.rect.zw+vec2u(1u))-c.rect.xy;
 // The pool slice the raster writes: the static slice for a static-cached instance.
 let slice=select(0u,vsm.staticSlice,c.staticLayer);
 for(var i=lane;i<size.x*size.y;i+=VSM_T_COMMAND_GROUP){
  if(vsmTPageKey(levelOffset,c.mip,rectCell(c.rect,size,i),c.markMask,slice)!=${NO_INDEX}u){atomicAdd(&wgFound,1u);}
 }
 workgroupBarrier();
 if(lane==0u){
  let found=atomicLoad(&wgFound);
  let base=atomicAdd(&counts[vsmRenderChunkCounter(params.chunk,1u)],found);
  wgBase=base;
  atomicStore(&wgFound,0u);
  vsmTHeader(index,vec4u(cmd.x,cmd.y,base,select(0u,min(found,frame.pairs-base),base<frame.pairs)));
 }
 let base=workgroupUniformLoad(&wgBase);
 for(var i=lane;i<size.x*size.y;i+=VSM_T_COMMAND_GROUP){
  let vPage=rectCell(c.rect,size,i);
  let key=vsmTPageKey(levelOffset,c.mip,vPage,c.markMask,slice);
  if(key==${NO_INDEX}u){continue;}
  let at=base+atomicAdd(&wgFound,1u);
  if(at>=frame.pairs){continue;}
  list[4u*frame.cmds+2u*at]=key;
  list[4u*frame.cmds+2u*at+1u]=vPage.x|(vPage.y<<8u);
 }
}
`,
    [
      VSM_HANDLE_WGSL,
      VSM_PAGE_ADDRESS_WGSL,
      vsmBindingsWgsl(0, VSM_TRANSMISSION_PAGES_SPECS, layout),
      VSM_PAGE_LOOKUP_WGSL,
      VSM_PAGE_MARKS_GATHER_WGSL,
      VSM_RENDER_COMMAND_WGSL,
      frameWgsl(layout),
      VSM_T_COMMAND_GROUP_WGSL,
      rectCell,
    ],
  )
