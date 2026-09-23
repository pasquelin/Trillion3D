import { WATER_RANK_SHIFT } from '../water/surfaceWgsl.ts';
import type { TransmissionBackdrop, WebgpuGpuState } from '../pages/state/gpu.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** `transmission`, `ior`, `thickness`, `attenuationDistance`, then aligned `attenuationColor`:
 *  one record per transmissive item, read by water rank in a storage buffer. */
export const VOLUME_WORDS = 8;
/** The frozen backdrop costs a half-float colour (8 bytes) per pixel, and the depth the surface
 *  stage tests and writes 4 more; the surfaces themselves are the opaque resolve's, already paid. */
const WATER_BYTES_PER_PIXEL = 8 + 4;

/** What the water pass adds to the image budget, zero with no transmissive surface. */
export function backdropBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  return rt.blendState.transmissive ? width * height * WATER_BYTES_PER_PIXEL : 0;
}

/**
 * Allocates what the water pass owns: the frozen colour its composite rereads, and the depth its
 * surface stage tests and writes. With no transmissive surface they are one texel: the bind
 * layouts are the same for the whole scene, and nothing is reserved for a class the scene does
 * not carry.
 */
export function createBackdrop(
  device: GPUDevice,
  width: number,
  height: number,
  active: boolean,
): TransmissionBackdrop {
  const size = { width: active ? width : 1, height: active ? height : 1 };
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
  const color = device.createTexture({
    label: 'WG backdrop color',
    size,
    format: 'rgba16float',
    usage,
  });
  const waterDepth = device.createTexture({
    label: 'WG water depth',
    size,
    format: 'depth32float',
    usage: usage | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  return {
    color,
    colorView: color.createView(),
    waterDepth,
    waterDepthView: waterDepth.createView(),
    active,
  };
}

export function disposeBackdrop(gpu: WebgpuGpuState) {
  const backdrop = gpu.backdrop;
  if (!backdrop) return;
  backdrop.color.destroy();
  backdrop.waterDepth.destroy();
  gpu.backdrop = undefined;
}

/** Water rank of an item, as its flags carry it: one-based, zero for an item that does not
 *  transmit (`../blend/prepare.ts`). */
export const waterRankOf = (flags: number) => flags >>> WATER_RANK_SHIFT;

/** Volume of each transmissive item, at the rank the item carries in its flags: that is the rank
 *  the composite reads through the water surface. Written with the rows, never per image. */
export function writeVolumeRecords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, blendState } = rt,
    packed = blendState.volumePacked;
  if (!gpu.volumeBuffer || !blendState.transmissive) return;
  for (const item of blendState.blendGpu) {
    const rank = waterRankOf(item.flags);
    if (!rank) continue;
    const base = (rank - 1) * VOLUME_WORDS,
      mat = item.surface;
    packed[base] = mat.transmission;
    packed[base + 1] = mat.ior;
    packed[base + 2] = mat.thickness;
    packed[base + 3] = mat.attenuationDistance;
    packed[base + 4] = mat.attenuationColor[0];
    packed[base + 5] = mat.attenuationColor[1];
    packed[base + 6] = mat.attenuationColor[2];
    packed[base + 7] = 0;
  }
  device.queue.writeBuffer(gpu.volumeBuffer, 0, packed);
}

/** Volume buffer, sized to the scene's transmissive-item count. */
export function createVolumeBuffer(device: GPUDevice, transmissive: number) {
  return device.createBuffer({
    label: 'WG transmissive volumes',
    size: Math.max(1, transmissive) * VOLUME_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}
