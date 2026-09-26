import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts';
import { levelSize, mipLevelCountFor } from './tiles.ts';
import { COVERAGE_SCALE_WGSL } from './coverageRule.ts';
import { countCoverage, LEVEL_BIN_BYTES, type CoverageChain } from './coverageMips.ts';

/**
 * Layout and reduction program, built ONCE per device; its pipeline once per format and per
 * colour rule.
 *
 * The mip chain is generated at every working texture: recompiling the same program and the same
 * layout at each made one pay a pipeline compilation per texture, on the very path that must
 * serve its tiles as fast as possible. The cache is held per device, so a lost device takes its
 * pipelines with it; it is built on the device itself (`sharedGpuDevice`), never on a session's
 * handle: it serves every session, and names none.
 */
type MipProgram = {
  layout: GPUBindGroupLayout;
  pipelineLayout: GPUPipelineLayout;
  module: GPUShaderModule;
  /** Per colour rule — plain at 0, weighted at 1 — the pipeline of each format. */
  pipelines: [Map<GPUTextureFormat, GPURenderPipeline>, Map<GPUTextureFormat, GPURenderPipeline>];
};
const programs = new WeakMap<GPUDevice, MipProgram>();

/**
 * Colours are averaged, alpha is the MEDIAN of the four texels — never their mean.
 *
 * Alpha of a foliage map is not a colour: it is what a masked material compares to its threshold.
 * A mean pulls each level toward the map's mean alpha; above the threshold, the silhouette grows
 * from one level to the next until the whole quad passes the test, loses its holes and combs into
 * an opaque rectangle in front of what is behind — which loading used to make visible, since the
 * cutout then reads the finest RESIDENT level, therefore a coarse level.
 *
 * The median of four values, itself, passes a GIVEN threshold exactly when two of the four texels
 * pass it: the coarse texel is kept when half of what it covers was, and threshold coverage is
 * preserved from one level to the next without depending on the threshold. That is what makes it
 * applicable here: the threshold belongs to the material, the mip chain to a texture several
 * materials share, and nothing at this place knows which threshold will be applied to it.
 *
 * Sorted decreasing, the median is the mean of the two middle values: `u` is the second, `v` the
 * third, six comparisons with neither a sort nor a branch.
 *
 * Under `weighted`, four texels whose alphas differ average their colours
 * weighted by alpha, and `select` keeps the plain mean everywhere else, byte for byte: the rule the
 * compiler bakes, and its reasons (`packages/asset-compiler-rust/src/texture_preview/reduce.rs`,
 * `halve`, #42).
 *
 * `extent` is the source's size, then a coverage chain's cutoff byte `C` and the level's `t`: with
 * `C`, the median byte is scaled to keep level 0's coverage (`coverageMips.ts`); without, the
 * median stays as it was, byte for byte.
 */
export const MIP_SHADER = `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> extent:vec4u;
 override weighted:bool;
 ${COVERAGE_SCALE_WGSL}
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
 }
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f{
  let p=vec2i(pos.xy)*2;let hi=vec2i(extent.xy)-vec2i(1);
  let s0=textureLoad(source,min(p,hi),0);let s1=textureLoad(source,min(p+vec2i(1,0),hi),0);
  let s2=textureLoad(source,min(p+vec2i(0,1),hi),0);let s3=textureLoad(source,min(p+vec2i(1,1),hi),0);
  let mean=(s0+s1+s2+s3)*0.25;
  let u=min(max(s0.w,s1.w),max(s2.w,s3.w));
  let v=max(min(s0.w,s1.w),min(s2.w,s3.w));
  let a=vec4f(s0.w,s1.w,s2.w,s3.w);
  let byAlpha=(s0.rgb*s0.w+s1.rgb*s1.w+s2.rgb*s2.w+s3.rgb*s3.w)/dot(a,vec4f(1.0));
  let cut=f32(scaled(median(a),extent.z,extent.w))/255.0;
  return vec4f(select(mean.rgb,byAlpha,weighted&&any(a!=vec4f(s0.w))),select((u+v)*0.5,cut,extent.z>0u));
 }`;

function mipProgram(device: GPUDevice): MipProgram {
  const held = programs.get(device);
  if (held) return held;
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });
  const built: MipProgram = {
    layout,
    pipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module: device.createShaderModule({ code: MIP_SHADER }),
    pipelines: [new Map(), new Map()],
  };
  programs.set(device, built);
  return built;
}

/** The bind group layout and the pipeline of one format and one colour rule. */
function mipPipeline(device: GPUDevice, format: GPUTextureFormat, weighted: boolean) {
  const { layout, module, pipelineLayout, pipelines } = mipProgram(device);
  const byFormat = pipelines[Number(weighted)];
  const held = byFormat.get(format);
  if (held) return { layout, pipeline: held };
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format }],
      constants: { weighted: Number(weighted) },
    },
    primitive: { topology: 'triangle-list' },
  });
  byFormat.set(format, pipeline);
  return { layout, pipeline };
}

/**
 * The buffers of the reductions — their uniforms, a coverage chain's bins —, kept per device and
 * label and grown as needed. Creating then destroying one at every texture forced waiting for the
 * end of the device's work before releasing it — a full round trip of the GPU queue per texture;
 * one that lives as long as the device rewrites itself in queue order, waiting for nothing. An
 * outgrown one is not destroyed: already-submitted passes may still read it, the collector frees it.
 */
const heldBuffers = new WeakMap<GPUDevice, Map<string, GPUBuffer>>();

function heldBuffer(device: GPUDevice, label: string, size: number, usage: number) {
  const kept = heldBuffers.get(device) ?? new Map<string, GPUBuffer>();
  heldBuffers.set(device, kept);
  const held = kept.get(label);
  if (held && held.size >= size) return held;
  const buffer = device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST });
  kept.set(label, buffer);
  return buffer;
}

/** Generates the mip chain of a 2D texture: averaged colour — weighted by alpha when `weighted`,
 * for a texture every reader takes for coverage, in straight alpha (`../webgpu/tile/scratch.ts`) —,
 * median alpha so that threshold coverage survives every level, scaled to keep level 0's share at
 * `cutoff` when the readers give one (`CoverageReaders.cutoff`).
 * Commands are submitted without being awaited: the device queue runs them in order, therefore
 * before any copy that will read a level. */
export function generateMaterialMips(
  device: GPUDevice,
  texture: GPUTexture,
  format: GPUTextureFormat,
  width: number,
  height: number,
  weighted: boolean,
  cutoff = 0,
) {
  const levels = mipLevelCountFor(width, height);
  if (levels === 1) return;
  const shared = sharedGpuDevice(device);
  const { layout, pipeline } = mipPipeline(shared, format, weighted);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  // One uniform block per level, its reduction's: the extent of the source level, so as not to read
  // off the image, and the cutoff; for the counts, level 0's extent and the level. Block 0 is level
  // 0's own count.
  const packed = new Uint32Array((levels * stride) / 4);
  for (let level = 0; level < levels; level++) {
    const source = levelSize(width, height, Math.max(0, level - 1));
    packed.set([...source, cutoff, 0, width, height, level], (level * stride) / 4);
  }
  const uniforms = heldBuffer(
    shared,
    'Trillion3D texture mips uniforms',
    packed.byteLength,
    GPUBufferUsage.UNIFORM,
  );
  device.queue.writeBuffer(uniforms, 0, packed);
  const encoder = device.createCommandEncoder();
  const views = Array.from({ length: levels }, (_, level) =>
    texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
  );
  let chain: CoverageChain | undefined;
  if (cutoff) {
    const size = levels * LEVEL_BIN_BYTES,
      usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
    const bins = heldBuffer(shared, 'Trillion3D coverage bins', size, usage);
    encoder.clearBuffer(bins, 0, size);
    chain = { width, height, views, uniforms, stride, bins };
  }
  for (let level = 1; level < levels; level++) {
    if (chain) countCoverage(device, encoder, chain, level);
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: views[level - 1] },
        { binding: 1, resource: { buffer: uniforms, offset: level * stride, size: 16 } },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: views[level], loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}
