import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createProgramGroups } from '../../gpu/bind/programGroups.ts'
import { createFrontLayer } from './frontLayer.ts'

/** A view's reflection as the transparent passes read it: its device, its front layer, a texel of each target on a
 *  kit device, and the forward programs' group. */
export function reflectionFront() {
  const { device } = fakeDevice()
  return { device, front: createFrontLayer(device, 1, 1, false), forward: createProgramGroups() }
}
