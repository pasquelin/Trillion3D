import type * as THREE from 'three';
import type { WebgpuGpuState } from './webgpuPagesStateGpu.ts';

/**
 * Les tampons de sommets d'une primitive transparente, tenus par la géométrie source et non par le
 * maillage qui la porte. Deux instances d'un même objet partagent leur géométrie : elles partagent
 * donc ces tampons, comme elles partageaient déjà leurs positions. Les octets écrits sont ceux
 * d'avant, écrits une fois au lieu d'une fois par placement, et comptés une fois dans `vertexBytes`.
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

/** Les indices d'une géométrie transparente non paginée, partagés par tous ses placements. */
export function ensureBlendIndexBuffer(
  device: GPUDevice,
  index: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
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

/** Les UV d'une géométrie transparente, dépliés une fois pour toutes ses instances. */
export function ensureBlendUvBuffer(
  device: GPUDevice,
  attributes: THREE.BufferGeometry['attributes'],
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

/** Normale et tangente d'une géométrie transparente, dans le même tampon et le même ordre qu'avant. */
export function ensureBlendNormalBuffer(
  device: GPUDevice,
  attributes: THREE.BufferGeometry['attributes'],
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

/** Rend au pilote les tampons partagés des transparents ; les items n'en possèdent aucun. */
export function dropBlendBuffers(gpu: WebgpuGpuState) {
  for (const buffer of gpu.blendIndexBuffers.values()) buffer.destroy();
  for (const buffer of gpu.blendUvBuffers.values()) buffer?.destroy();
  for (const buffer of gpu.blendNormalBuffers.values()) buffer?.destroy();
  gpu.blendIndexBuffers.clear();
  gpu.blendUvBuffers.clear();
  gpu.blendNormalBuffers.clear();
}
