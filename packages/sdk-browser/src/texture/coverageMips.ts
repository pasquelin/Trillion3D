import { COVERAGE_PICK_WGSL, COVERAGE_SCALE_WGSL } from './coverageRule.ts';
import { levelSize } from './tiles.ts';

/**
 * The counts of the coverage rule (docs/FORMAT.md, "Coverage-preserving alpha"): `count` files each
 * texel's alpha byte — level 0's own, a level's median from the one above — in its level's 256
 * bins, `choose` then picks that level's `t`, one thread, and leaves it in bin 0, which it never
 * reads (`t >= 1`). `level`: the source's extent, `C`, `t`, then level 0's extent and the level.
 */
export const COVERAGE_WGSL = `
 @group(0) @binding(0) var source:texture_2d<f32>;
 struct Level{extent:vec4u,base:vec4u}
 @group(0) @binding(1) var<uniform> level:Level;
 @group(0) @binding(2) var<storage,read_write> cover:array<atomic<u32>>;
 fn binOf(t:u32)->u32{return atomicLoad(&cover[level.base.z*256u+t]);}
 ${COVERAGE_SCALE_WGSL}
 ${COVERAGE_PICK_WGSL}
 fn sizeOf(k:u32)->vec2u{return max(level.base.xy>>vec2u(k),vec2u(1u));}
 @compute @workgroup_size(8,8) fn count(@builtin(global_invocation_id) id:vec3u){
  let k=level.base.z;
  if(any(id.xy>=sizeOf(k))){return;}
  let p=vec2i(id.xy)*2;let hi=vec2i(level.extent.xy)-vec2i(1);
  var a=u32(round(textureLoad(source,vec2i(id.xy),0).w*255.0));
  if(k>0u){
   a=median(vec4f(textureLoad(source,min(p,hi),0).w,textureLoad(source,min(p+vec2i(1,0),hi),0).w,
    textureLoad(source,min(p+vec2i(0,1),hi),0).w,textureLoad(source,min(p+vec2i(1,1),hi),0).w));
  }
  atomicAdd(&cover[k*256u+a],1u);
 }
 @compute @workgroup_size(1) fn choose(){
  let c=level.extent.z;var covered=0u;
  for(var b=c;b<256u;b++){covered+=atomicLoad(&cover[b]);}
  let n0=sizeOf(0u);let nk=sizeOf(level.base.z);
  atomicStore(&cover[level.base.z*256u],pick(c,covered,vec2u(n0.x*n0.y,nk.x*nk.y)));
 }`;

type CoverageProgram = {
  layout: GPUBindGroupLayout;
  count: GPUComputePipeline;
  pick: GPUComputePipeline;
};
const programs = new WeakMap<GPUDevice, CoverageProgram>();

function coverageProgram(device: GPUDevice): CoverageProgram {
  const held = programs.get(device);
  if (held) return held;
  const visibility = GPUShaderStage.COMPUTE;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility, texture: { sampleType: 'float' } },
      { binding: 1, visibility, buffer: { type: 'uniform' } },
      { binding: 2, visibility, buffer: { type: 'storage' } },
    ],
  });
  const module = device.createShaderModule({ code: COVERAGE_WGSL });
  const pipeline = (entryPoint: string) =>
    device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint },
    });
  const built = { layout, count: pipeline('count'), pick: pipeline('choose') };
  programs.set(device, built);
  return built;
}

/** What a chain's counts read: its texture, the uniform blocks of `generateMaterialMips` — block
 *  `k - 1` for level `k`, the last one level 0's — and the device's bins, cleared. */
export type CoverageChain = {
  texture: GPUTexture;
  width: number;
  height: number;
  uniforms: GPUBuffer;
  stride: number;
  levels: number;
  bins: GPUBuffer;
};

/** Counts level `level` of `chain` (level 0 first, before level 1) and copies its `t` into the
 *  level's uniform block, the one its reduction then scales by. */
export function countCoverage(
  device: GPUDevice,
  shared: GPUDevice,
  encoder: GPUCommandEncoder,
  chain: CoverageChain,
  level: number,
) {
  const { layout, count, pick } = coverageProgram(shared);
  const { texture, width, height, uniforms, stride, levels, bins } = chain;
  const group = (block: number, source: number) =>
    device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: texture.createView({ baseMipLevel: source, mipLevelCount: 1 }) },
        { binding: 1, resource: { buffer: uniforms, offset: block * stride, size: 32 } },
        { binding: 2, resource: { buffer: bins } },
      ],
    });
  const pass = encoder.beginComputePass();
  pass.setPipeline(count);
  const dispatch = ([w, h]: [number, number]) =>
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
  if (level === 1) {
    pass.setBindGroup(0, group(levels - 1, 0));
    dispatch([width, height]);
  }
  pass.setBindGroup(0, group(level - 1, level - 1));
  dispatch(levelSize(width, height, level));
  pass.setPipeline(pick);
  pass.dispatchWorkgroups(1);
  pass.end();
  encoder.copyBufferToBuffer(bins, level * 1024, uniforms, (level - 1) * stride + 12, 4);
}
