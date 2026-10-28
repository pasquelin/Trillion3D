import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/** Whether the image the clock last decided is the final one of its establishment, the one the view is held on. */
export const isFinalImage = (run: WebgpuPagesRuntime['run']) => {
  const clock = run.gate.hold.noise
  return clock.final && clock.anchor === run.frame
}
