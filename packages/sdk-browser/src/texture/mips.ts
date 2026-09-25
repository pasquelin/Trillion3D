import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts';

/** Full mip chain length for a texture of the given size. */
export function mipLevelCountFor(width: number, height: number) {
  return 1 + Math.floor(Math.log2(Math.max(width, height)));
}

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
 */
const MIP_SHADER = `
 @group(0) @binding(0) var source:texture_2d<f32>;
 @group(0) @binding(1) var<uniform> extent:vec4u;
 override weighted:bool;
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
  return vec4f(select(mean.rgb,byAlpha,weighted&&any(a!=vec4f(s0.w))),(u+v)*0.5);
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
 * Uniform buffer of the reductions, kept per device and grown as needed.
 *
 * Creating then destroying it at every texture forced waiting for the end of the device's work
 * before releasing it — a full round trip of the GPU queue per texture. A buffer that lives as
 * long as the device rewrites itself in queue order, waiting for nothing. Like the program, it
 * is the device's own.
 */
const uniformBuffers = new WeakMap<GPUDevice, { buffer: GPUBuffer; size: number }>();

function mipUniforms(device: GPUDevice, size: number) {
  const held = uniformBuffers.get(device);
  if (held && held.size >= size) return held.buffer;
  const buffer = device.createBuffer({
    label: 'Trillion3D texture mips uniforms',
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  // The old buffer is not destroyed: already-submitted passes may still read it, and the
  // garbage collector will release it. Growth only happens at the first larger texture.
  uniformBuffers.set(device, { buffer, size });
  return buffer;
}

/** Generates the mip chain of a 2D texture: averaged colour — weighted by alpha when `weighted`,
 * for a texture every reader takes for coverage, in straight alpha (`../webgpu/tile/scratch.ts`) —,
 * median alpha so that threshold coverage survives every level.
 * Commands are submitted without being awaited: the device queue runs them in order, therefore
 * before any copy that will read a level. */
export function generateMaterialMips(
  device: GPUDevice,
  texture: GPUTexture,
  format: GPUTextureFormat,
  width: number,
  height: number,
  weighted: boolean,
) {
  const levels = mipLevelCountFor(width, height);
  if (levels === 1) return;
  const shared = sharedGpuDevice(device);
  const { layout, pipeline } = mipPipeline(shared, format, weighted);
  const stride = Math.max(256, device.limits.minUniformBufferOffsetAlignment ?? 256);
  // One uniform per reduced level: the extent of the source level, so as not to read off the image.
  const packed = new Uint32Array(((levels - 1) * stride) / 4);
  for (let level = 1; level < levels; level++) {
    const at = ((level - 1) * stride) / 4;
    packed[at] = Math.max(1, width >> (level - 1));
    packed[at + 1] = Math.max(1, height >> (level - 1));
  }
  const uniforms = mipUniforms(shared, packed.byteLength);
  device.queue.writeBuffer(uniforms, 0, packed);
  const encoder = device.createCommandEncoder();
  const viewOf = (level: number) => texture.createView({ baseMipLevel: level, mipLevelCount: 1 });
  for (let level = 1; level < levels; level++) {
    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: viewOf(level - 1) },
        { binding: 1, resource: { buffer: uniforms, offset: (level - 1) * stride, size: 16 } },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: viewOf(level), loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }
  device.queue.submit([encoder.finish()]);
}
