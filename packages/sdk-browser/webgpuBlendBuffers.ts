import type { HostAttribute, HostAttributes } from './hostResources.ts';
import type * as THREE from 'three';
import type { WebgpuGpuState } from './webgpuPagesStateGpu.ts';

/**
 * Vertex buffers of a transparent primitive, held by the source geometry and not by the mesh that
 * carries it. Two instances of the same object share their geometry: they therefore share these
 * buffers, as they already shared their positions. The bytes written are the previous ones,
 * written once instead of once per placement, and counted once in `vertexBytes`.
 */
function upload(device: GPUDevice, data: ArrayBufferView, floor: number, tally: WebgpuGpuState) {
  const buffer = device.createBuffer({
    size: Math.max(floor, data.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  tally.vertexBytes += buffer.size;
  return buffer;
}

/** Indices of an unpaged transparent geometry, shared by all of its placements. */
export function ensureBlendIndexBuffer(
  device: GPUDevice,
  index: HostAttribute,
  gpu: WebgpuGpuState,
) {
  const held = gpu.blendIndexBuffers.get(index);
  if (held) return held;
  const src = index.array;
  const data = src instanceof Uint32Array ? src : new Uint32Array(src as ArrayLike<number>);
  const buffer = upload(device, data, 4, gpu);
  gpu.blendIndexBuffers.set(index, buffer);
  return buffer;
}

/** UVs of a transparent geometry, unfolded once for all of its instances. */
export function ensureBlendUvBuffer(
  device: GPUDevice,
  attributes: HostAttributes,
  gpu: WebgpuGpuState,
) {
  if (gpu.blendUvBuffers.has(attributes)) return gpu.blendUvBuffers.get(attributes);
  const uv = attributes.uv;
  let buffer: GPUBuffer | undefined;
  if (uv) {
    const data = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) {
      data[i * 2] = uv.getX(i);
      data[i * 2 + 1] = uv.getY(i);
    }
    buffer = upload(device, data, 8, gpu);
  }
  gpu.blendUvBuffers.set(attributes, buffer);
  return buffer;
}

/** Normal and tangent of a transparent geometry, in the same buffer and the same order as before. */
export function ensureBlendNormalBuffer(
  device: GPUDevice,
  attributes: HostAttributes,
  gpu: WebgpuGpuState,
) {
  if (gpu.blendNormalBuffers.has(attributes)) return gpu.blendNormalBuffers.get(attributes);
  const normal = attributes.normal,
    tangent = attributes.tangent;
  let buffer: GPUBuffer | undefined;
  if (normal) {
    const data = new Float32Array(normal.count * 7);
    for (let i = 0; i < normal.count; i++) {
      data[i * 7] = normal.getX(i);
      data[i * 7 + 1] = normal.getY(i);
      data[i * 7 + 2] = normal.getZ(i);
      if (tangent) {
        data[i * 7 + 3] = tangent.getX(i);
        data[i * 7 + 4] = tangent.getY(i);
        data[i * 7 + 5] = tangent.getZ(i);
        data[i * 7 + 6] = tangent.getW(i);
      }
    }
    buffer = upload(device, data, 12, gpu);
  }
  gpu.blendNormalBuffers.set(attributes, buffer);
  return buffer;
}

/** Returns the transparents' shared buffers to the driver; items own none of them. */
export function dropBlendBuffers(gpu: WebgpuGpuState) {
  for (const buffer of gpu.blendIndexBuffers.values()) buffer.destroy();
  for (const buffer of gpu.blendUvBuffers.values()) buffer?.destroy();
  for (const buffer of gpu.blendNormalBuffers.values()) buffer?.destroy();
  gpu.blendIndexBuffers.clear();
  gpu.blendUvBuffers.clear();
  gpu.blendNormalBuffers.clear();
}
