// What the reflection rig binds in place of the run-time proxy (`runtime-proxy.gpu.ts` proves it): its empty
// header in each of its four places, and a store of one texel when the view holds none.
import {
  RUNTIME_HEADER_WORDS,
  STORE_LAYERS,
} from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'
import type { ScreenReflection } from '../../../packages/sdk-browser/src/reflections/gpu.ts'

export function noRuntimeProxy(device: GPUDevice, reflection: ScreenReflection) {
  const empty = device.createBuffer({
    size: (RUNTIME_HEADER_WORDS + 1) * 4,
    usage: GPUBufferUsage.STORAGE,
  })
  return {
    runtime: { proxy: empty, nodes: empty, cold: empty, worlds: empty },
    store:
      reflection.store.view ??
      device
        .createTexture({
          size: [1, 1, STORE_LAYERS],
          format: 'r32uint',
          usage: GPUTextureUsage.STORAGE_BINDING,
        })
        .createView({ dimension: '2d-array' }),
  }
}
