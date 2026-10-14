import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createFrontLayer } from './frontLayer.ts'
import { createProxyStore } from './proxyStore.ts'

/** A view's reflection as the transparent passes read it: its front layer, a texel of each target on a
 *  kit device, and the store of the proxy's answers, unmade. */
export function reflectionFront() {
  const { device } = fakeDevice()
  return {
    front: createFrontLayer(device, 1, 1, false),
    store: createProxyStore(device, 1, 1, false),
  }
}
