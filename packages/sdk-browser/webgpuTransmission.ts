import { visMaterial } from './visibilityBuffer.ts';
import type { TransmissionBackdrop, WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** A dynamic uniform offset aligns on 256 bytes; the volume occupies 32 and leaves the rest empty,
 *  which a few dozen transmissive materials pay in kilobytes. */
export const VOLUME_STRIDE = 256;
/** `transmission`, `ior`, `thickness`, `attenuationDistance`, then aligned `attenuationColor`. */
export const VOLUME_SIZE = 32;
/** The backdrop costs a half-float colour (8 bytes) and a depth (4) per pixel. */
const BACKDROP_BYTES_PER_PIXEL = 12;

/** What the backdrop copies will add to the image budget, zero with no transmissive surface. */
export function backdropBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  return rt.blendState.transmissive ? width * height * BACKDROP_BYTES_PER_PIXEL : 0;
}

/**
 * Allocates the two copies the transmission pass rereads. With no transmissive surface they are one
 * texel: the bind layout is the same for the whole scene, and nothing is reserved for a class the
 * scene does not carry.
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
  const depth = device.createTexture({
    label: 'WG backdrop depth',
    size,
    format: 'depth32float',
    usage,
  });
  return { color, colorView: color.createView(), depth, depthView: depth.createView(), active };
}

export function disposeBackdrop(gpu: WebgpuGpuState) {
  gpu.backdrop?.color.destroy();
  gpu.backdrop?.depth.destroy();
  gpu.backdrop = undefined;
}

/**
 * Freezes the backdrop: already-resolved colour and opaque depth, copied as-is. These two textures
 * are what *every* transmissive surface reads, so the order between two of them does not change what
 * they see — and none sees through the other, a known limit, the same as the glTF reference viewer.
 */
export function copyBackdrop(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu } = rt,
    backdrop = gpu.backdrop;
  if (!backdrop?.active || !gpu.hdrTexture || !gpu.depthTexture) return false;
  const [width, height] = gpu.targetSize;
  encoder.copyTextureToTexture(
    { texture: gpu.hdrTexture },
    { texture: backdrop.color },
    { width, height },
  );
  encoder.copyTextureToTexture(
    { texture: gpu.depthTexture },
    { texture: backdrop.depth },
    { width, height },
  );
  return true;
}

/** Volume of each item, at the rank the item carries in the scene: that is the dynamic offset the
 *  transmission pass posts. Written with the rows, never per image. */
export function writeVolumeRecords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, blendState } = rt,
    items = blendState.blendGpu,
    packed = blendState.volumePacked;
  if (!gpu.volumeBuffer || !items.length) return;
  for (let i = 0; i < items.length; i++) {
    const base = i * (VOLUME_STRIDE / 4),
      mat = visMaterial(items[i].material);
    packed[base] = mat.transmission;
    packed[base + 1] = mat.ior;
    packed[base + 2] = mat.thickness;
    packed[base + 3] = mat.attenuationDistance;
    packed[base + 4] = mat.attenuationColor[0];
    packed[base + 5] = mat.attenuationColor[1];
    packed[base + 6] = mat.attenuationColor[2];
    packed[base + 7] = 0;
  }
  device.queue.writeBuffer(
    gpu.volumeBuffer,
    0,
    packed.subarray(0, items.length * (VOLUME_STRIDE / 4)),
  );
}

/** Volume buffer, sized to the scene's transparent-item count. */
export function createVolumeBuffer(device: GPUDevice, items: number) {
  return device.createBuffer({
    label: 'WG transmissive volumes',
    size: Math.max(1, items) * VOLUME_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}
