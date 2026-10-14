import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createFrontLayer } from './frontLayer.ts'

/** A view's reflection as the transparent passes read it: its front layer, a texel of each target on a
 *  kit device. */
export function reflectionFront() {
  const { device } = fakeDevice()
  return { front: createFrontLayer(device, 1, 1, false) }
}
