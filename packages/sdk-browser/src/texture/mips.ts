import { mipShader } from './mipsWgsl.ts';

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
