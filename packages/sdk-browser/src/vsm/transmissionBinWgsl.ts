import { wgslProgram } from '../../../math/src/wgsl/assemble.ts'
import { byteOf } from '../../../math/src/wgsl/integer.ts'
import { PAGE_BINDING } from '../visibility/shader/pageWgsl.ts'
import { FLAG_HAS_UV } from '../visibility/types.ts'
import { materialDeclarations } from '../webgpu/tile/wgsl.ts'
import { VSM_PAGE_TEXELS } from './constants.ts'
import type { VsmLayout } from './layout.ts'
import { vsmTransmissionRecordWgsl } from './transmissionRecordWgsl.ts'
import { VSM_T_COMMAND_GROUP_WGSL } from './transmissionShared.ts'

/**
 * One group per command (`vsmTransmissionPages` listed its slices). Its row's triangles, a thread
 * each, 64 at a time: their corners decoded, deformed and placed in the world by the camera's own
 * functions (`pageTriangle`, `pagePosition`: the shadow is cast by the surface drawn), projected
 * as the opaque raster does (same matrix, same origin shift, a directional caster nearer than the
 * near plane flattened onto it, a local light's triangle clipped by its near plane into 0 to 2
 * triangles); facing the light and `volumeBoundary` as the old pass; the transmittance
 * `blendTransmittance` along the flat ray (the light's axis, or from the light to the first
 * corner); a triangle that lets all through keeps no corner. Each is projected once for every
 * page of the command, into the group's memory. Then every (page, triangle) of the command, a
 * thread each: a triangle whose box on the level misses the page by more than a texel is skipped
 * (the box is the same corners' before the page's corner is taken off, so the margin only ever
 * keeps more), the others go to `vsmTRecord` with the corners in the page's texels — the record,
 * its patch for a textured caster (a quantised transmittance at each texel centre of its box on
 * the page grown by a texel, the uv gradients one texel apart, \`maskKeep\` cutting to white), and
 * the cells it may cover, which the resolve lists. Counters keep counting past a capacity: the
 * feedback reads what the frame wanted.
 *
 * Group 0 = the engine's shadow page group. Group 1: 0 the chunk's page list, 1 projection data,
 * 2 frame uniform, 3 build buffer. The material reads are the shadow pool's (`maskAlpha` for
 * `maskKeep` and the transmittance, `colorSample` for its tint).
 */
export const vsmTransmissionBinWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
${PAGE_BINDING.indices}
${PAGE_BINDING.positions}
${PAGE_BINDING.pages}
${materialDeclarations()}
@group(1) @binding(0) var<storage,read> list:array<u32>;
@group(1) @binding(1) var<storage,read> vsmProjectionData:array<VsmProjectionRecord>;
@group(1) @binding(2) var<uniform> frame:VsmTransmissionFrame;
@group(1) @binding(3) var<storage,read_write> build:array<atomic<u32>>;
var<workgroup> tris:array<VsmTTri,VSM_T_COMMAND_GROUP>;
var<workgroup> wgCommand:array<u32,5>;
@compute @workgroup_size(VSM_T_COMMAND_GROUP) fn vsmTransmissionBin(@builtin(workgroup_id) wid:vec3u,@builtin(num_workgroups) nwg:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=flatIndex(wid,nwg,1u);
 if(index>=frame.cmds){return;}
 if(lane==0u){
  for(var j=0u;j<4u;j++){wgCommand[j]=list[4u*index+j];}
  wgCommand[4]=select(0u,pages[wgCommand[0]].indexCount/3u,wgCommand[3]>0u);
 }
 let triangles=workgroupUniformLoad(&wgCommand[4]);
 if(triangles==0u){return;}
 let row=wgCommand[0];let view=wgCommand[1];let first=wgCommand[2];let found=wgCommand[3];
 let page=pages[row];
 let raw=vsmProjectionData[view&0xFFFFu];
 let h=pageHeaderFor(page,(page.flags&${FLAG_HAS_UV}u)!=0u);
 let scale=f32(VSM_LEVEL0_TEXELS>>((view>>16u)&7u));
 for(var batch=0u;batch<triangles;batch+=VSM_T_COMMAND_GROUP){
  var tri:VsmTTri;
  if(batch+lane<triangles){tri=vsmTProject(page,h,batch+lane,view,raw);}
  tris[lane]=tri;
  workgroupBarrier();
  let n=min(VSM_T_COMMAND_GROUP,triangles-batch);
  for(var w=lane;w<found*n;w+=VSM_T_COMMAND_GROUP){
   let p=w/n;let i=w-p*n;
   if(tris[i].count<3u){continue;}
   let e=4u*frame.cmds+2u*(first+p);
   let v=list[e+1u];
   let corner=f32(VSM_PAGE_TEXELS)*vec2f(f32(byteOf(v,0u)),f32(byteOf(v,1u)));
   let b=tris[i].box;
   if(b.z<corner.x-1.0||b.w<corner.y-1.0||b.x>=corner.x+${VSM_PAGE_TEXELS + 1}.0||b.y>=corner.y+${VSM_PAGE_TEXELS + 1}.0){continue;}
   var t=tris[i];
   for(var f=1u;f+1u<t.count;f++){
    let c=array<VsmTCorner,3>(VsmTCorner(t.h[0],t.uv[0]),VsmTCorner(t.h[f],t.uv[f]),VsmTCorner(t.h[f+1u],t.uv[f+1u]));
    let x=array<vec2f,3>(vsmTTexel(c[0].h,scale,corner),vsmTTexel(c[1].h,scale,corner),vsmTTexel(c[2].h,scale,corner));
    vsmTRecord(page,row,list[e],x,c,t.shape,t.q,t.ray);
   }
  }
  workgroupBarrier();
 }
}
`,
    [vsmTransmissionRecordWgsl(layout), VSM_T_COMMAND_GROUP_WGSL, byteOf],
  )
