import type { HostAttributes } from './hostResources.ts';
import type * as THREE from 'three';

/** Uploads shared source positions once for opaque and transparent draws. */
export function ensureWebgpuPositionBuffer(
  device: GPUDevice,
  attributes: HostAttributes,
  buffers: Map<HostAttributes, GPUBuffer>,
  tally: { vertexBytes: number },
) {
  const existing = buffers.get(attributes);
  if (existing) return existing;
  const position = attributes.position;
  if (!position) return undefined;
  const xyz = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    xyz[i * 3] = position.getX(i);
    xyz[i * 3 + 1] = position.getY(i);
    xyz[i * 3 + 2] = position.getZ(i);
  }
  const buffer = device.createBuffer({
    label: 'WG positions',
    size: xyz.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, xyz.buffer);
  buffers.set(attributes, buffer);
  tally.vertexBytes += buffer.size;
  return buffer;
}
