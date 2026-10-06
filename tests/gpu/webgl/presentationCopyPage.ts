// Page side of the presentation copy proof: an image presented on a canvas of its own, carried away
// by the engine's synchronous capture — its own WebGL2 program (`createCanvasBlit`), no texture or
// material of a rendering library — and compared byte for byte with what was presented, rows in the
// convention the SDK publishes: the first row read is the last row presented.
import { createSynchronousCanvasCapture } from '../../../packages/sdk-browser/src/gpu/core/presentation.ts'

const WIDTH = 64,
  HEIGHT = 48

/** A pattern no flip, transposition or offset can leave looking the same. */
function presented() {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2d context unavailable')
  const image = context.createImageData(WIDTH, HEIGHT)
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4
      image.data[i] = (x * 4) & 255
      image.data[i + 1] = (y * 5) & 255
      image.data[i + 2] = (x + y) & 255
      image.data[i + 3] = 255
    }
  context.putImageData(image, 0, 0)
  return { canvas, data: image.data }
}

/** The capture of the presented pattern against the pattern bottom row first: the bytes compared,
 *  how many differ and by how much at most. */
export function execute() {
  const source = presented()
  const expected = new Uint8Array(source.data.length)
  for (let y = 0; y < HEIGHT; y++)
    expected.set(
      source.data.subarray((HEIGHT - 1 - y) * WIDTH * 4, (HEIGHT - y) * WIDTH * 4),
      y * WIDTH * 4,
    )
  const capture = createSynchronousCanvasCapture()
  try {
    const read = capture.read(source.canvas)
    let differentChannels = 0,
      maxChannelError = 0
    for (let i = 0; i < expected.length; i++) {
      if (read[i] !== expected[i]) differentChannels++
      maxChannelError = Math.max(maxChannelError, Math.abs(read[i] - expected[i]))
    }
    return {
      bytes: read.length,
      expectedBytes: expected.length,
      differentChannels,
      maxChannelError,
    }
  } finally {
    capture.dispose()
  }
}
