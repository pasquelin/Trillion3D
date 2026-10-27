import type { GraphClocks } from '../../materials/graph/clocks.ts'
import { GRAPH_FRAME_AT, GRAPH_FRAME_BYTES } from '../../visibility/shader/graphFrameWgsl.ts'

/**
 * THE GRAPH FRAME'S WRITER (`graphFrameWgsl.ts`): the buffer the passes bind and the words it holds.
 * `write` sets the clocks and the camera of an image, the ones before being those of the image it
 * last wrote — the first image's own, so that nothing moves by what no image has seen —, and sends
 * them up once an image. The buffer is made at the first ask (`bufferOn`) and holds the last words.
 */
export function createGraphFrame() {
  const words = new Float32Array(GRAPH_FRAME_BYTES / 4)
  // The same words as whole numbers: the image's number is one, not a float.
  const ints = new Uint32Array(words.buffer)
  let buffer: GPUBuffer | undefined,
    seen = false
  return {
    /** The buffer, made at the first ask on `device`, holding the words written so far. */
    bufferOn(device: GPUDevice) {
      if (buffer) return buffer
      buffer = device.createBuffer({
        label: 'Trillion3D graph frame',
        size: GRAPH_FRAME_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
      device.queue.writeBuffer(buffer, 0, words)
      return buffer
    },
    /** The image's clocks and camera taken, whether the blue noise is bound (`noise`) and the view's image number (`frame`, which
     *  the dither of a cutout walks the noise by), sent where the buffer is made. */
    write(
      device: GPUDevice | undefined,
      clocks: GraphClocks,
      eye: ArrayLike<number>,
      noise: boolean,
      frame: number,
    ) {
      const { clock, eye: now, before } = GRAPH_FRAME_AT
      for (let a = 0; a < 3; a++) words[before + a] = seen ? words[now + a]! : eye[a]!
      words[clock + 2] = seen ? words[clock]! : clocks.time
      words[clock + 3] = seen ? words[clock + 1]! : clocks.realTime
      words[clock] = clocks.time
      words[clock + 1] = clocks.realTime
      for (let a = 0; a < 3; a++) words[now + a] = eye[a]!
      words[now + 3] = noise ? 1 : 0
      ints[before + 3] = frame >>> 0
      seen = true
      if (buffer && device) device.queue.writeBuffer(buffer, 0, words)
    },
    /** The words, as last written. */
    words: () => words,
  }
}

export type GraphFrame = ReturnType<typeof createGraphFrame>
