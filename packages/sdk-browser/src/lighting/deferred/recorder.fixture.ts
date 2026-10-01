// The deferred lighting's frames, recorded: the program each draw is lit with (#849, #1369).
import type { createDeferredLighting } from './deferred.ts';
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts';

/** The frames of `lighting`, each lit with `direct`, and the label of each program drawn with. */
export function recorder(lighting: Awaited<ReturnType<typeof createDeferredLighting>>) {
  const labels: string[] = [];
  const encoder = {
    beginRenderPass: () => ({
      setPipeline: (pipeline: GPURenderPipelineDescriptor) =>
        labels.push(pipeline.fragment!.module.label),
      setBindGroup() {},
      setViewport() {},
      draw() {},
      end() {},
    }),
  } as unknown as GPUCommandEncoder;
  const views = [0, 1, 2, 3].map(() => ({}) as GPUTextureView),
    surface = { views: () => views } as unknown as SurfaceBuffer,
    view = {} as GPUTextureView;
  const draw = (direct: { narrow?: boolean; unshadowed?: boolean; rectless?: boolean }) => {
    lighting.bind(surface, view, view, true, { lights: {} as GPUBuffer, ...direct });
    if (lighting.usesContract) lighting.light(encoder, view);
    return lighting.usesContract;
  };
  return { labels, draw };
}
