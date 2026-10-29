import type { EngineCamera } from '../camera/engineCamera.ts'
import { createDebugLines, type DebugLines } from '../hair/debugLines.ts'
import { createDebugLinesGpu, type DebugLinesGpu } from '../hair/debugLinesPass.ts'

/** The pixels between two lines of text in a diagnostic view's table. */
export const TEXT_LINE = 14

/**
 * THE TEXT OF A DIAGNOSTIC VIEW over the display image: the words and figures a view writes (`lines.text`, the mini font of `../hair/debugFont.ts`) and the pass that draws them as lines
 * (`../hair/debugLinesPass.ts`), made at the first image that draws any and kept by their owner.
 */
export function createTextOverlay(device: GPUDevice) {
  const lines: DebugLines = createDebugLines()
  let gpu: DebugLinesGpu | undefined
  return {
    lines,
    /** Empties the text for an image seen from `cam`. */
    begin: (cam: EngineCamera) => lines.begin(cam.eye),
    /** Draws what was written over `target` (`size` display pixels). */
    encode(
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      size: readonly [number, number],
      cam: EngineCamera,
    ) {
      gpu ??= createDebugLinesGpu(device)
      gpu.encode(encoder, target, size, cam.viewProjectionRelative, lines, {})
    },
    dispose() {
      gpu?.dispose()
      gpu = undefined
    },
  }
}
