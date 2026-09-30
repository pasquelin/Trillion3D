import { COVERAGE_SCALE_WGSL } from './coverageRule.ts';
import { RADIANCE_REDUCTION_WGSL } from './radianceReduction.ts';

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
  pipelines: Map<string, GPURenderPipeline>;
};
const programs = new WeakMap<GPUDevice, Map<boolean, MipProgram>>();

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
 * third, six comparisons with neither a sort nor a branch (`reducedAlpha`, `coverageRule.ts`).
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
 override radiance:bool=false;
 override bounds:bool=false;
 fn mipRead(p:vec2i)->vec4f{return textureLoad(source,p,0);}
 ${RADIANCE_REDUCTION_WGSL}
 ${COVERAGE_SCALE_WGSL}
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
  return vec4f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1),0.0,1.0);
 }
 @fragment fn fs(@builtin(position) pos:vec4f)->@location(0) vec4f{
  if(radiance){return radianceReduction(vec2i(pos.xy));}
  let p=vec2i(pos.xy)*2;let hi=vec2i(extent.xy)-vec2i(1);
  let s0=mipRead(min(p,hi));let s1=mipRead(min(p+vec2i(1,0),hi));
  let s2=mipRead(min(p+vec2i(0,1),hi));let s3=mipRead(min(p+vec2i(1,1),hi));
  let mean=(s0+s1+s2+s3)*0.25;
  let a=vec4f(s0.w,s1.w,s2.w,s3.w);
  let byAlpha=(s0.rgb*s0.w+s1.rgb*s1.w+s2.rgb*s2.w+s3.rgb*s3.w)/dot(a,vec4f(1.0));
  return vec4f(select(mean.rgb,byAlpha,weighted&&any(a!=vec4f(s0.w))),reducedAlpha(a,extent.z,extent.w));
 }`;

/** Source variants share the runtime constructor with the shader manifest. */
export const mipShader = (depth: boolean) =>
  depth
    ? MIP_SHADER.replace('source:texture_2d<f32>', 'source:texture_depth_2d').replace(
        'return textureLoad(source,p,0);',
        'let z=textureLoad(source,p,0);return select(vec4f(z,z,0.0,1.0),vec4f(1.0,0.0,0.0,0.0),z==0.0);',
      )
    : MIP_SHADER;

function mipProgram(device: GPUDevice, depth: boolean): MipProgram {
  let variants = programs.get(device);
  if (!variants) programs.set(device, (variants = new Map()));
  const held = variants.get(depth);
  if (held) return held;
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: depth ? 'depth' : 'unfilterable-float' },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const built: MipProgram = {
    layout,
    pipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module: device.createShaderModule({ code: mipShader(depth) }),
    pipelines: new Map(),
  };
  variants.set(depth, built);
  return built;
}

/** The bind group layout and the pipeline of one format and one colour rule. */
export function mipPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  weighted: boolean,
  rule: 'material' | 'radiance' | 'bounds' | 'depth' = 'material',
) {
  const { layout, module, pipelineLayout, pipelines } = mipProgram(device, rule === 'depth');
  const key = `${format}/${Number(weighted)}/${rule}`;
  const held = pipelines.get(key);
  if (held) return { layout, pipeline: held };
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format }],
      constants: {
        weighted: Number(weighted),
        radiance: Number(rule !== 'material'),
        bounds: Number(rule === 'bounds' || rule === 'depth'),
      },
    },
    primitive: { topology: 'triangle-list' },
  });
  pipelines.set(key, pipeline);
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

export function heldBuffer(device: GPUDevice, label: string, size: number, usage: number) {
  const kept = heldBuffers.get(device) ?? new Map<string, GPUBuffer>();
  heldBuffers.set(device, kept);
  const held = kept.get(label);
  if (held && held.size >= size) return held;
  const buffer = device.createBuffer({ label, size, usage: usage | GPUBufferUsage.COPY_DST });
  kept.set(label, buffer);
  return buffer;
}
