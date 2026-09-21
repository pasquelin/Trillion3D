import {
  ST_REJECTED,
  ST_REJECTED_TRIANGLES,
  ST_TESTED,
  VERDICT_KEPT,
  VERDICT_REJECTED,
} from './gpuPartitionContract.ts';
import { HIZ_FAR_WGSL } from './gpuHizRectWgsl.ts';

/** `GPUShaderStage.COMPUTE`, written in the clear: this module is also read from Node, without that global. */
const COMPUTE = 4;

/**
 * Group-0 bindings, published under the WGSL that declares them. The production layout and the
 * browser proofs READ them here — none copies them, so none can lag behind the shader. That
 * lag is what turned `hiz-webgpu.browser.ts` red: its copy had stopped at `@binding(4)` while
 * `state` entered at 5.
 */
export function hizBindEntries(uniformBytes: number): GPUBindGroupLayoutEntry[] {
  return [
    { binding: 0, visibility: COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: COMPUTE, texture: { sampleType: 'unfilterable-float' } },
    {
      binding: 2,
      visibility: COMPUTE,
      buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: uniformBytes },
    },
    { binding: 3, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: COMPUTE, buffer: { type: 'storage' } },
    { binding: 5, visibility: COMPUTE, buffer: { type: 'storage' } },
  ];
}

/**
 * The three Hi-Z pyramid kernels. The test no longer receives a count or bytes from the CPU: it
 * reads the box count and writes its own reject counters into the state the GPU partition holds,
 * and the boxes are those the partition packed in the same submission. No value is inferred
 * there: a verdict is written, or the row stays at zero.
 */
export const HIZ_SHADER = `struct Uni{a:u32,b:u32,c:u32,d:u32,e:u32,f:u32,g:u32,h:u32,}
struct Bounds{minX:i32,minY:i32,maxX:i32,maxY:i32,nearest:f32,rowAndClip:u32,pad0:u32,pad1:u32,triangles:u32,pad2:u32,pad3:u32,pad4:u32,}
@group(0) @binding(0) var<storage, read_write> pyramid:array<f32>;
@group(0) @binding(1) var level0:texture_2d<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
@group(0) @binding(3) var<storage, read> bounds:array<Bounds>;
@group(0) @binding(4) var<storage, read_write> flags:array<u32>;
@group(0) @binding(5) var<storage, read_write> state:array<atomic<u32>>;
@compute @workgroup_size(8, 8)
fn copyDepth(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.a||id.y>=uni.b){return;}
 let z=textureLoad(level0,vec2i(i32(id.x),i32(id.y)),0).r;
 pyramid[uni.c+id.y*uni.a+id.x]=z;
}
@compute @workgroup_size(8, 8)
fn reduceHiz(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.e||id.y>=uni.f){return;}
 let x0=id.x*2u;let y0=id.y*2u;
 // Reverse-Z: the FARTHEST of a square is the MINIMUM.
 var far=pyramid[uni.a+y0*uni.b+x0];
 if(x0+1u<uni.b){far=min(far,pyramid[uni.a+y0*uni.b+x0+1u]);}
 if(y0+1u<uni.c){
  far=min(far,pyramid[uni.a+(y0+1u)*uni.b+x0]);
  if(x0+1u<uni.b){far=min(far,pyramid[uni.a+(y0+1u)*uni.b+x0+1u]);}
 }
 pyramid[uni.d+id.y*uni.e+id.x]=far;
}
${HIZ_FAR_WGSL}
// Only boxes the frame tests travel this far, each carrying the verdict row it answers for;
// rows the frame does not test were cleared before this pass. The box count is the one the
// partition compacted: the CPU does not know it.
@compute @workgroup_size(64)
fn testHiz(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=atomicLoad(&state[${ST_TESTED}u])){return;}
 let b=bounds[i];
 let row=b.rowAndClip>>1u;
 // A tested row the pyramid cannot judge stays drawn: kept, never an occluder — the compute
 // raster draws occluders in its other mode.
 if((b.rowAndClip&1u)!=0u||b.maxX<b.minX||b.maxY<b.minY){flags[row]=${VERDICT_KEPT}u;return;}
 let far=pyramidFar(b.minX,b.minY,b.maxX,b.maxY,b.pad0,b.pad1);
 let bias=bitcast<f32>(uni.d);
 // Reverse-Z: a box is rejected when its NEAREST point stays behind the pyramid's farthest,
 // hence when it is SMALLER.
 let reject=select(0u,1u,b.nearest<far-bias);
 flags[row]=select(${VERDICT_KEPT}u,${VERDICT_REJECTED}u,reject!=0u);
 if(reject!=0u){
  atomicAdd(&state[${ST_REJECTED}u],1u);
  atomicAdd(&state[${ST_REJECTED_TRIANGLES}u],b.triangles);
 }
}
`;
