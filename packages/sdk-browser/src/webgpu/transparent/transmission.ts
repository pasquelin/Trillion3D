import { WATER_RANK_SHIFT } from '../water/rank.ts';
import { refreshSurface } from '../../page/surface.ts';
import type { TransmissionBackdrop, WebgpuGpuState } from '../pages/state/gpu.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { WATER_BYTES_PER_PIXEL } from './waterBytes.ts';
import { volumeAttenuation } from './volumeLaw.ts';

/** `transmission`, the refraction ratio 1 / ior, `thickness`, Fresnel's f0 = ((ior − 1) / (ior + 1))²,
 *  then aligned the volume's attenuation `k` (`volumeAttenuation`) and the fog word: one record per
 *  transmissive item, read by water rank in a storage buffer. The per-volume terms are computed
 *  here once, in f64, not per pixel in f32. */
export const VOLUME_WORDS = 8;

/** What the water pass adds to the image budget, zero with no transmissive surface. */
export function backdropBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  return rt.blendState.transmissive ? width * height * WATER_BYTES_PER_PIXEL : 0;
}

/**
 * Allocates what the water pass owns: the frozen colour its composite rereads, and the depth its
 * surface stage writes. With no transmissive surface they are one texel: the bind
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
    label: 'Trillion3D backdrop color',
    size,
    format: 'rgba16float',
    usage,
  });
  const waterDepth = device.createTexture({
    label: 'Trillion3D water depth',
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
    packed = blendState.volumePacked,
    k = [0, 0, 0];
  if (!gpu.volumeBuffer || !blendState.transmissive) return;
  for (const item of blendState.blendGpu) {
    const rank = waterRankOf(item.flags);
    if (!rank) continue;
    const base = (rank - 1) * VOLUME_WORDS,
      mat = refreshSurface(item.surface);
    const reflectance = (mat.ior - 1) / (mat.ior + 1);
    packed[base] = mat.transmission;
    packed[base + 1] = 1 / Math.max(mat.ior, 1e-3);
    packed[base + 2] = mat.thickness;
    packed[base + 3] = reflectance * reflectance;
    packed.set(volumeAttenuation(mat.attenuationColor, mat.attenuationDistance, k), base + 4);
    packed[base + 7] = mat.fog === false ? 1 : 0;
  }
  device.queue.writeBuffer(gpu.volumeBuffer, 0, packed);
}

/** Volume buffer, sized to the scene's transmissive-item count. */
export function createVolumeBuffer(device: GPUDevice, transmissive: number) {
  return device.createBuffer({
    label: 'Trillion3D transmissive volumes',
    size: Math.max(1, transmissive) * VOLUME_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}
