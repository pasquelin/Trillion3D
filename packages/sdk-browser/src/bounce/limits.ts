/**
 * What bounce will ask of the device, compared to what the device declares it can hold.
 *
 * A binding larger than a limit does not fail where it is written: the buffer is born
 * invalid, the error bubbles uncaught, and it is the first frame that binds the group that
 * loses the device — far from the cause. Sizes are therefore all computed before a single
 * buffer is created, compared to `device.limits`, and a scene too large for this device is
 * refused bounce with the measurement that missed, never with a guess.
 */

import type { SceneProxy } from '../../../sdk-core/src/index.ts';
import { PROXY_HEADER_BYTES } from './nodeWgsl.ts';
import { surfaceCacheBytes } from './surfaceWgsl.ts';
import { BOUNCE_GRID_BYTES } from './uniform.ts';

/** A planned binding: its diagnostic name, its bytes, and the limit that bounds it. */
type BounceBinding = {
  name: string;
  bytes: number;
  limit: 'maxStorageBufferBindingSize' | 'maxUniformBufferBindingSize';
};

/**
 * The first overflow, written in the clear, or `null` when everything fits. Binding order is
 * creation order: the message names the first that does not pass, not the largest.
 */
function bounceLimitFailure(device: GPUDevice, bindings: readonly BounceBinding[]) {
  const { limits } = device;
  for (const { name, bytes, limit } of bindings) {
    if (bytes > limits[limit])
      return `bounce binding "${name}" needs ${bytes} bytes, over this device's ${limit} of ${limits[limit]}`;
    if (bytes > limits.maxBufferSize)
      return `bounce buffer "${name}" needs ${bytes} bytes, over this device's maxBufferSize of ${limits.maxBufferSize}`;
  }
  return null;
}

/**
 * Resident-proxy bytes: its header, then its three columns back to back in the single
 * buffer the traversal binds. A proxy without data keeps the four words of the empty binding.
 */
function residentProxyBytes(proxy: SceneProxy) {
  const data = proxy.data;
  const columns =
    (data?.triangles.byteLength ?? 0) +
    (data?.nodeBounds.byteLength ?? 0) +
    (data?.nodeChildren.byteLength ?? 0);
  return PROXY_HEADER_BYTES + Math.max(16, columns);
}

/**
 * Bytes of each binding bounce will create, in the order it creates them: the resident
 * proxy and its albedo, the two probe copies, the frame queue, the surface cache and
 * the cascade uniform.
 */
function plannedBindings(
  proxy: SceneProxy,
  probeBytes: number,
  queueBytes: number,
): BounceBinding[] {
  const data = proxy.data,
    storage = 'maxStorageBufferBindingSize';
  return [
    { name: 'resident proxy', bytes: residentProxyBytes(proxy), limit: storage },
    { name: 'proxy albedo', bytes: data?.albedo.byteLength ?? 4, limit: storage },
    { name: 'probes', bytes: probeBytes, limit: storage },
    { name: 'probes snapshot', bytes: probeBytes, limit: storage },
    { name: 'probe queue', bytes: queueBytes, limit: storage },
    { name: 'surface cache', bytes: surfaceCacheBytes(proxy.triangles), limit: storage },
    { name: 'cascades uniform', bytes: BOUNCE_GRID_BYTES, limit: 'maxUniformBufferBindingSize' },
  ];
}

/**
 * Refuses bounce before a single buffer is created when this device cannot hold it.
 * The caller surfaces the message as-is: it is the one that says which binding missed and by how much.
 */
export function ensureBounceFits(
  device: GPUDevice,
  proxy: SceneProxy,
  probeBytes: number,
  queueBytes: number,
) {
  const failure = bounceLimitFailure(device, plannedBindings(proxy, probeBytes, queueBytes));
  if (failure) throw new Error(failure);
}
