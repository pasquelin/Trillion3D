import type { SceneProxy, BounceCascades } from '../../../sdk-core/src/index.ts';
import { constructGpuResources } from '../gpu/core/errorScope.ts';
import { createGpuBounceProxy } from './proxy.ts';
import { createBounceUniform } from './uniform.ts';

/** Initial probe storage is atomic even when admission refuses the last buffer. */
export function createProbeStorage(
  device: GPUDevice,
  proxy: SceneProxy,
  cascades: BounceCascades,
  queueBytes: number,
  probeBytes: number,
) {
  return constructGpuResources(device, () => {
    const resident = createGpuBounceProxy(device, proxy);
    const uniform = createBounceUniform(device, cascades);
    const queue = device.createBuffer({
      label: 'Trillion3D bounce probe queue v1',
      size: queueBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const probes = device.createBuffer({
      label: 'Trillion3D bounce probes v2',
      size: probeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const snapshot = device.createBuffer({
      label: 'Trillion3D bounce probes snapshot v2',
      size: probeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    return { resident, uniform, queue, probes, snapshot };
  });
}
