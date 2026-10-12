// What the reflection rig binds in place of the run-time proxy (`runtimeProxyPage.ts` proves it): its empty
// header in each of its four places, no history, and the radiance hash its epoch follows.
import { RUNTIME_HEADER_WORDS } from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'
import type { ScreenReflection } from '../../../packages/sdk-browser/src/reflections/gpu.ts'

export function noRuntimeProxy(device: GPUDevice, reflection: ScreenReflection) {
  const empty = device.createBuffer({
    size: RUNTIME_HEADER_WORDS * 4,
    usage: GPUBufferUsage.STORAGE,
  })
  return {
    runtime: { proxy: empty, nodes: empty, cold: empty, worlds: empty },
    history:
      reflection.history.buffer ??
      device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC }),
    hash: reflection.settle.hash,
  }
}
