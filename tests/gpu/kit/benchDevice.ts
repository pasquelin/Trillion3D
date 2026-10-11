import { installGpu } from '../../../bench/dawn/device.ts'

/** The bench's GPU on Dawn, unconstrained, and a device with timestamp queries: what every proof of
 *  the bench opens first. */
export async function openBenchDevice() {
  const gpu = installGpu({ limits: null, featuresOff: [] })
  const adapter = (await navigator.gpu.requestAdapter())!
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
  return { gpu, device }
}
