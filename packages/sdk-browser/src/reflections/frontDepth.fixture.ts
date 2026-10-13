import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createFrontDepth } from './frontDepth.ts'

/** A view's reflection as the transparent passes read it: its front depth, a texel on a kit
 *  device. */
export const reflectionFront = () => ({ front: createFrontDepth(fakeDevice().device, 1, 1, false) })
