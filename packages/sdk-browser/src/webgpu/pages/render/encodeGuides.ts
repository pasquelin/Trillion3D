import { createWebgpuGuidePass } from '../../../guides/guidePass.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/**
 * Whether this image draws guides, and the set's revision it draws: what `guidesMoved` compares
 * before holding a frame. Read before composition, which then leaves presentation to the copy
 * that follows the guide pass.
 */
export function guidesShown(rt: WebgpuPagesRuntime) {
  const guides = rt.context.guides;
  if (!guides) return false;
  rt.gpu.guideRevision = guides.revision;
  return guides.visibleInstances() > 0;
}

/** True when the page changed its guides since the last encoded image: a held frame would miss it. */
export const guidesMoved = (rt: WebgpuPagesRuntime) =>
  !!rt.context.guides && rt.context.guides.revision !== rt.gpu.guideRevision;

const NO_JITTER = [0, 0] as const;

/** The guide pass over the composed image (`createWebgpuGuidePass`), built on first use. */
export function encodeWebgpuGuides(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, context } = rt;
  if (!context.guides || !gpu.colorView || !gpu.depthView) return;
  gpu.guides ??= createWebgpuGuidePass(device);
  const { colorView, depthView, targetSize } = gpu;
  // The jitter the scene depth was drawn with: that of the image when it accumulates.
  const frame = gpu.temporal?.frame;
  const jitter = frame?.active ? frame.jitter : NO_JITTER;
  const drawn = gpu.guides.encode(
    encoder,
    context.guides,
    colorView,
    depthView,
    cam,
    targetSize,
    jitter,
  );
  if (drawn) rt.run.gpuDrawCalls++;
}
