import { visMaterial } from './visibilityBuffer.ts';
import { createSurfaceBuffer } from './surfaceBuffer.ts';
import type { TransmissionBackdrop, WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** `transmission`, `ior`, `thickness`, `attenuationDistance`, then aligned `attenuationColor`:
 *  one record per transparent item, read by rank in a storage buffer. */
export const VOLUME_WORDS = 8;
/** The backdrop costs a half-float colour (8 bytes) and a depth (4) per pixel; the water surfaces
 *  the four targets of a surface buffer (28) and their own depth (4). */
const WATER_BYTES_PER_PIXEL = 12 + 28 + 4;

/** What the water pass adds to the image budget, zero with no transmissive surface. */
export function backdropBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  return rt.blendState.transmissive ? width * height * WATER_BYTES_PER_PIXEL : 0;
}

/**
 * Allocates what the water pass reads and writes: the two frozen copies — colour and opaque
 * depth — its composite rereads, the surface buffer its surface stage writes, and the depth that
 * stage tests and writes. With no transmissive surface they are one texel: the bind layouts are
 * the same for the whole scene, and nothing is reserved for a class the scene does not carry.
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
  const surfaces = createSurfaceBuffer(device, size.width, size.height);
  const waterDepth = device.createTexture({
    label: 'WG water depth',
    size,
    format: 'depth32float',
    usage: usage | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  return {
    color,
    colorView: color.createView(),
    depth,
    depthView: depth.createView(),
    surfaces,
    waterDepth,
    waterDepthView: waterDepth.createView(),
    active,
  };
}

export function disposeBackdrop(gpu: WebgpuGpuState) {
  const backdrop = gpu.backdrop;
  if (!backdrop) return;
  backdrop.color.destroy();
  backdrop.depth.destroy();
  backdrop.surfaces.dispose();
  backdrop.waterDepth.destroy();
  gpu.backdrop = undefined;
}

/**
 * Freezes the backdrop: already-resolved colour and opaque depth, copied as-is. These two textures
 * are what *every* transmissive surface reads, so the order between two of them does not change what
 * they see — and none sees through the other, a known limit, the same as the glTF reference viewer.
 * The opaque depth is copied a second time, into the depth the surface stage tests: a surface
 * behind an opaque is rejected by the hardware, and never reaches the composite.
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
  for (const texture of [backdrop.depth, backdrop.waterDepth])
    encoder.copyTextureToTexture({ texture: gpu.depthTexture }, { texture }, { width, height });
  return true;
}

/** Volume of each item, at the rank the item carries in the scene: that is the rank the composite
 *  reads through the water surface. Written with the rows, never per image. */
export function writeVolumeRecords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, blendState } = rt,
    items = blendState.blendGpu,
    packed = blendState.volumePacked;
  if (!gpu.volumeBuffer || !items.length) return;
  for (let i = 0; i < items.length; i++) {
    const base = i * VOLUME_WORDS,
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
  device.queue.writeBuffer(gpu.volumeBuffer, 0, packed.subarray(0, items.length * VOLUME_WORDS));
}

/** Volume buffer, sized to the scene's transparent-item count. */
export function createVolumeBuffer(device: GPUDevice, items: number) {
  return device.createBuffer({
    label: 'WG transmissive volumes',
    size: Math.max(1, items) * VOLUME_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}
