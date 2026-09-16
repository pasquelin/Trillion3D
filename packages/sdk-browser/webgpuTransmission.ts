import { visMaterial } from './visibilityBuffer.ts';
import type { TransmissionBackdrop, WebgpuGpuState } from './webgpuPagesStateGpu.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Un décalage dynamique d'uniforme s'aligne sur 256 octets ; le volume en occupe 32 et laisse le
 *  reste vide, ce que quelques dizaines de matériaux transmissifs paient en kilo-octets. */
export const VOLUME_STRIDE = 256;
/** `transmission`, `ior`, `thickness`, `attenuationDistance`, puis `attenuationColor` alignée. */
export const VOLUME_SIZE = 32;
/** Le fond coûte une couleur demi-flottante (8 octets) et une profondeur (4) par pixel. */
const BACKDROP_BYTES_PER_PIXEL = 12;

/** Ce que les copies du fond ajouteront au budget d'image, zéro sans surface transmissive. */
export function backdropBytes(rt: WebgpuPagesRuntime, width: number, height: number) {
  return rt.blendState.transmissive ? width * height * BACKDROP_BYTES_PER_PIXEL : 0;
}

/**
 * Alloue les deux copies que la passe de transmission relit. Sans surface transmissive, elles font
 * un texel : la disposition de liaison est la même pour toute la scène, et rien n'est réservé pour
 * une classe que la scène ne porte pas.
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
 * Fige le fond : la couleur déjà résolue et la profondeur des opaques, copiées telles quelles. Ces
 * deux textures sont ce que *toutes* les surfaces transmissives lisent, si bien que l'ordre entre
 * deux d'entre elles ne change pas ce qu'elles voient — et qu'aucune ne se voit à travers l'autre,
 * limite connue, la même que celle du visualiseur de référence glTF.
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

/** Le volume de chaque item, au rang que l'item porte dans la scène : c'est le décalage dynamique
 *  que la passe de transmission pose. Écrit avec les fiches, jamais par image. */
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

/** Le tampon des volumes, dimensionné sur le nombre d'items transparents de la scène. */
export function createVolumeBuffer(device: GPUDevice, items: number) {
  return device.createBuffer({
    label: 'WG transmissive volumes',
    size: Math.max(1, items) * VOLUME_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}
