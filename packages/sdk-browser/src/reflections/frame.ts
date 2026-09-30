import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { reflectionFrame } from './reflectionFrame.ts';

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
    rt.context.unboundedReflections === true,
  );
}
