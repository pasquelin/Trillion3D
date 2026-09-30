import { AS_IS_SHARE_SHADER } from './asIsShareWgsl.ts';
import { BLEND_EQUATIONS } from '../../scene/materialBlending.ts';

/** Red, the as-is share; green, the reactive value (#833). */
export const AS_IS_SHARE_FORMAT: GPUTextureFormat = 'rg8unorm';
/** Bytes per pixel of that format, as the frame's target cost counts them (`targets.ts`). */
export const AS_IS_SHARE_BYTES = 2;

/** The target as a blend writes it (`../../webgpu/blend/pipelines.ts`): its coverage over what
 *  the pixel holds, in both channels. */
export const SHARE_TARGET: GPUColorTargetState = {
  format: AS_IS_SHARE_FORMAT,
  blend: BLEND_EQUATIONS.normal,
};

/** The reactive value's target as a particle and the water composite write it
 *  (`../../particles/webgpuParticleDraw.ts`, `../../webgpu/water/pipelines.ts`): the same, green
 *  alone (`GPUColorWrite.GREEN`). */
export const REACTIVE_TARGET: GPUColorTargetState = { ...SHARE_TARGET, writeMask: 0x2 };

/**
 * The current image's debug-view share, seeded from opaque flags before transparents blend it, and
 * beside it the reactive value, seeded 0: each blend, particle and the water composite writes 1 at
 * its coverage over it (`../../webgpu/water/compositeWgsl.ts`), so a pixel behind transparents holds
 * their accumulated opacity. The temporal pass shortens a moving pixel's history by it
 * (`../../taa/historyWgsl.ts`).
 */
export function createAsIsShare(
  device: GPUDevice,
  flags: GPUTextureView,
  width: number,
  height: number,
) {
  const texture = device.createTexture({
    label: 'Trillion3D current as-is share',
    size: { width, height },
    format: AS_IS_SHARE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const view = texture.createView();
  const module = device.createShaderModule({ code: AS_IS_SHARE_SHADER });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } }],
  });
  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint: 'seed', targets: [{ format: AS_IS_SHARE_FORMAT }] },
    primitive: { topology: 'triangle-list' },
  });
  const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: flags }] });
  return {
    view,
    seed(encoder: GPUCommandEncoder) {
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D as-is share seed',
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    },
    dispose: () => texture.destroy(),
  };
}

export type AsIsShare = ReturnType<typeof createAsIsShare>;
