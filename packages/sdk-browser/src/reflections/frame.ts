import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { liveMotion, placementEpoch, reflectionFrame } from './reflectionFrame.ts';
import type { ReflectionSourceInputs } from './source.ts';

const sources = new WeakMap<object, ReflectionSourceInputs>();

export function updateScreenReflection(
  rt: WebgpuPagesRuntime,
  matrix: ArrayLike<number>,
  enabled: boolean,
) {
  rt.gpu.reflection?.update(
    matrix,
    enabled,
    rt.gpu.targetSize,
    reflectionFrame(rt),
    reflectionSourceInputs(rt),
  );
}

/** What the last image is reprojected through: this image's identifiers and placement motion, and
 *  the depth and identifiers kept for the next one. The image itself is the unfogged one the
 *  lighting wrote beside the lit image (`source.ts`), never the HDR target. */
function reflectionSourceInputs(rt: WebgpuPagesRuntime) {
  const { gpu, vis, run } = rt;
  if (!gpu.reflection?.active || !gpu.depthTexture) return undefined;
  if (!vis.visView || !vis.visTexture || !vis.pageTable) return undefined;
  let inputs = sources.get(gpu.reflection);
  if (!inputs) {
    inputs = { metadata: {} } as ReflectionSourceInputs;
    sources.set(gpu.reflection, inputs);
  }
  inputs.ids = vis.visView;
  inputs.pages = vis.pageTable;
  inputs.motion = liveMotion(rt, vis.pageTable);
  inputs.eye = run.gate.cam.eye;
  inputs.metadata.depth = gpu.depthTexture;
  inputs.metadata.ids = vis.visTexture;
  inputs.placement = placementEpoch(rt);
  return inputs;
}
