import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createFrontDepth } from './frontDepth.ts'
import { createProxyStore } from './proxyStore.ts'

/** A view's reflection as the transparent passes read it: its front depth, a texel on a kit
 *  device, and the store of the proxy's answers, unmade: no front layer, no front pass. */
export function reflectionFront() {
  const { device } = fakeDevice()
  return {
    front: createFrontDepth(device, 1, 1, false),
    store: createProxyStore(device, 1, 1, false),
  }
}
