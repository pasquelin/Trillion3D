// The view uniform's writer over a fake device, for the tests of what each image writes (`viewWrite.test.ts`,
// `viewLanes.test.ts`).
import { REFLECTION_VIEW_WORDS } from './viewLayout.ts'
import { heldImage } from './heldImage.fixture.ts'
import { createReflectionViewWriter } from './viewWrite.ts'
import { perspectiveProjection } from '../../../../math/src/projection/camera.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { FakeBuffer } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'

/** A device whose queue lays each write into the words of one view uniform: what the buffer holds
 *  after each call, and the writes it took. */
export function viewDevice() {
  const gpu = fakeDevice()
  const buffer = gpu.device.createBuffer({
    size: (REFLECTION_VIEW_WORDS + 16) * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { data } = buffer as unknown as FakeBuffer
  const words = new Float32Array(data.buffer, data.byteOffset, REFLECTION_VIEW_WORDS + 16)
  const held = {
    words,
    bits: new Uint32Array(words.buffer, words.byteOffset, words.length),
    get writes() {
      return gpu.writes.length
    },
    /** The word past the last one written. */
    get last() {
      return Math.max(0, ...gpu.writes.map((w) => (w.offset + w.data.byteLength) / 4))
    },
  }
  return { device: gpu.device, buffer, held }
}

/** A writer over a still held image of 64 × 32, and a perspective frame of that size carrying
 *  `extra`. */
export function stillView<Extra extends object>(extra: Extra) {
  const { device, buffer, held: sent } = viewDevice()
  const held = heldImage({
    valid: true,
    viewProjection: new Float64Array(16).fill(1),
    size: [64, 32],
  })
  const frame = {
    viewProjection: perspectiveProjection(new Float64Array(16), 90, 1, 0.1, 1),
    size: [64, 32] as const,
    depthDrawn: true,
    eye: [0, 0, 0],
    ...extra,
  }
  return { sent, write: createReflectionViewWriter(device, buffer), held, frame }
}
