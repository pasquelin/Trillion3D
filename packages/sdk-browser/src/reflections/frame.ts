import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { reflectionFrame } from './reflectionFrame.ts'
import { mirrorWalksImage } from './gpu.ts'

export function updateScreenReflection(
  rt: WebgpuPagesRuntime,
  matrix: ArrayLike<number>,
  enabled: boolean,
) {
  const reflection = rt.gpu.reflection
  reflection?.update(
    matrix,
    enabled,
    rt.gpu.targetSize,
    reflectionFrame(rt),
    reflection.mirror && mirrorWalksImage(rt),
  )
}
