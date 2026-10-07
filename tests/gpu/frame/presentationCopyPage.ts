// Page of the presentation copy proof: a pattern no flip, transposition, offset or channel swap
// leaves looking the same, written into a display image; the engine's presenter
// (`createGpuPresenter`) puts it on a canvas of its own, and the engine's capture readback
// (`readGpuImage`) carries it away. Both are read back and compared with the pattern.
import type { FakeCanvas } from '../../../bench/dawn/canvas.ts'
import { createGpuPresenter } from '../../../packages/sdk-browser/src/gpu/core/presentation.ts'
import { readGpuImage } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'
import { pipelinesSettled } from '../../../packages/sdk-browser/src/lighting/deferred/compileLedger.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { flipRows, gaps, readCanvasRgba, writePattern } from '../kit/patternImage.ts'

const WIDTH = 64,
  HEIGHT = 48

/** What the proof reads: how far the capture and the canvas lie from the pattern, the canvas's
 *  size, whether the presenter knows the canvas holds the image, and whether disposing it
 *  withdrew the image. */
export interface PresentationCopy {
  capture: ReturnType<typeof gaps>
  presented: ReturnType<typeof gaps>
  size: number[]
  holds: boolean
  withdrawn: boolean
}

export const run = () =>
  runOnDevice<PresentationCopy>(async (device, _events, result) => {
    const image = device.createTexture({
      label: 'presentation copy proof',
      size: [WIDTH, HEIGHT],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    })
    const rows = writePattern(device, image, [WIDTH, HEIGHT], (x, y) => [
      (x * 4) & 255,
      (y * 5) & 255,
      (x + 3 * y) & 255,
      255,
    ])
    // Read bottom row first, the convention the SDK publishes.
    const expected = flipRows(rows, WIDTH)
    const canvas = document.createElement('canvas') as unknown as FakeCanvas
    // Before the presenter configures it: the canvas texture is read back.
    canvas.readable = true
    const surface = canvas as unknown as HTMLCanvasElement
    document.body.append(surface)
    const presenter = createGpuPresenter(device, surface)
    try {
      result.capture = gaps(await readGpuImage(device, image, WIDTH, HEIGHT), expected)
      await pipelinesSettled(device)
      const encoder = device.createCommandEncoder()
      presenter.present(encoder, image, WIDTH, HEIGHT)
      device.queue.submit([encoder.finish()])
      const context = surface.getContext('webgpu') as GPUCanvasContext
      const shown = context.getCurrentTexture()
      result.presented = gaps(await readCanvasRgba(device, shown), expected)
      result.size = [shown.width, shown.height]
      result.holds = presenter.holds(image, WIDTH, HEIGHT)
      presenter.dispose()
      result.withdrawn = context.getConfiguration() === null
    } finally {
      image.destroy()
      canvas.remove()
    }
  })
