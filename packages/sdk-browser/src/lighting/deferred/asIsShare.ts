import { AS_IS_SHARE_SHADER } from './asIsShareWgsl.ts';
import { BLEND_EQUATIONS } from '../../scene/materialBlending.ts';
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts';
import { preparedPipeline, started } from './fullscreen.ts';

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

/** The seed's program, once a device, compiled off the thread from the first frame entry of a scene
 *  whose transparents or particles can write the share (`askAsIsSeed`): frame targets made again at
 *  another size compile nothing (#1362), and the image that first seeds finds it compiled. */
const seedProgram = oncePerDevice((device) => {
  const module = device.createShaderModule({ code: AS_IS_SHARE_SHADER });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } }],
  });
  const pipeline = started(
    preparedPipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'fullscreen' },
      fragment: { module, entryPoint: 'seed', targets: [{ format: AS_IS_SHARE_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    }),
  );
  return { layout, pipeline };
});

/** Asks the seed's program of `device` off the frame, the frames held until it landed
 *  (`../../webgpu/frame/framePipelines.ts`). */
export const askAsIsSeed = (device: GPUDevice) => void seedProgram(device).pipeline.ask();

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
  const { layout, pipeline } = seedProgram(device);
  const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: flags }] });
  return {
    view,
    /** Clears the share and its reactive value to 0, then, on an image that can hold an as-is
     *  pixel (`asIs`, `readsAsIs`), seeds the share from the flags. Any other image's flags hold no
     *  as-is pixel (only a row shown as-is or a diagnostic view writes one): the seed would write
     *  the clear's zeros again, so its draw is left out. */
    seed(encoder: GPUCommandEncoder, asIs: boolean) {
      const pass = encoder.beginRenderPass({
        label: 'Trillion3D as-is share seed',
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      });
      if (asIs) {
        pass.setPipeline(pipeline.get());
        pass.setBindGroup(0, group);
        pass.draw(3);
      }
      pass.end();
    },
    dispose: () => texture.destroy(),
  };
}

export type AsIsShare = ReturnType<typeof createAsIsShare>;
