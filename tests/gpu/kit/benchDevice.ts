import { installGpu } from '../../../bench/dawn/device.ts'

/** The bench's GPU on Dawn, unconstrained, and a device with timestamp queries: what every proof of
 *  the bench opens first. */
export async function openBenchDevice() {
  const gpu = installGpu({ limits: null, featuresOff: [] })
  const adapter = (await navigator.gpu.requestAdapter())!
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
  return { gpu, device }
}

/** `code`'s `main` as a compute pipeline, and its bind group: `out`, its one binding (0 of group 0),
 *  what the bench's timing proofs dispatch. */
export function kernelOn(device: GPUDevice, code: string, out: GPUBuffer) {
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  })
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: out } }],
  })
  return { pipeline, bind }
}
