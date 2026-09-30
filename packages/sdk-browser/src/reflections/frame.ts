import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { liveMotion, reflectionFrame } from './reflectionFrame.ts';
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

/** What the last lit image is reprojected from: the HDR target it still holds (`encode.ts`). */
function reflectionSourceInputs(rt: WebgpuPagesRuntime) {
  const { gpu, vis, run } = rt;
  if (!gpu.reflection?.active || !gpu.hdrView || !vis.visView || !vis.pageTable) return undefined;
  let inputs = sources.get(gpu.reflection);
  if (!inputs) sources.set(gpu.reflection, (inputs = {} as ReflectionSourceInputs));
  inputs.last = gpu.hdrView;
  inputs.ids = vis.visView;
  inputs.pages = vis.pageTable;
  inputs.motion = liveMotion(rt, vis.pageTable);
  inputs.eye = run.gate.cam.eye;
  return inputs;
}
