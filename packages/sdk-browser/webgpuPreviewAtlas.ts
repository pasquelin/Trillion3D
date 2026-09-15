import type * as THREE from 'three';
import { PREVIEW_LEVEL_SIZES, type TexturePreview } from '../sdk-core/index.ts';

/** Côté du niveau le plus fin d'un aperçu : l'atlas entier tient en 16×16 par couche. */
const PREVIEW_SIZE = PREVIEW_LEVEL_SIZES[0];

/**
 * L'atlas des aperçus : une deuxième texture-tableau 16×16 `rgba8unorm-srgb` avec ses cinq
 * niveaux, aux mêmes indices de couche que l'atlas couleur et à l'échelle uv 1. Chaque couche porte
 * un bit « prêt » : le shader lit l'aperçu tant qu'il vaut zéro, l'atlas couleur dès qu'il vaut un.
 * Le bit ne passe à un qu'après le transfert complet de la vraie texture et la régénération de ses
 * mips, si bien qu'une texture abandonnée garde son aperçu au lieu de retomber sur du blanc.
 */
export type WebgpuPreviewAtlas = {
  texture: GPUTexture;
  view: GPUTextureView;
  ready: GPUBuffer;
  /** Couches réellement alimentées par un aperçu du sidecar; les autres portent le blanc. */
  readonly withPreview: number;
  markReady(layers: readonly number[]): void;
  destroy(): void;
};

/**
 * La lecture partagée par toutes les passes qui échantillonnent l'atlas couleur : l'aperçu 16×16
 * tant que le bit « prêt » de la couche vaut zéro, l'atlas couleur dès qu'il vaut un. L'aperçu
 * couvre toute sa couche, donc il se lit aux coordonnées brutes, sans l'échelle uv de l'atlas.
 * Le shader hôte déclare `maps`, `previews`, `mapsSampler` et `previewReady` à ses propres liaisons.
 */
export const COLOR_SAMPLE_WGSL = `fn colorSample(layer:u32,scale:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f{
 if(previewReady[layer]==0u){return textureSampleGrad(previews,mapsSampler,uv,i32(layer),ddx,ddy);}
 return textureSampleGrad(maps,mapsSampler,uv*scale,i32(layer),ddx*scale,ddy*scale);
}`;

/** Le blanc d'attente d'une couche sans aperçu, au format et à la taille de chaque niveau. */
function whiteLevels() {
  return PREVIEW_LEVEL_SIZES.map((size) => new Uint8Array(size * size * 4).fill(255));
}

function writeLayer(
  device: GPUDevice,
  texture: GPUTexture,
  layer: number,
  levels: readonly Uint8Array<ArrayBuffer>[],
) {
  PREVIEW_LEVEL_SIZES.forEach((size, level) => {
    device.queue.writeTexture(
      { texture, mipLevel: level, origin: [0, 0, layer] },
      levels[level],
      { bytesPerRow: size * 4, rowsPerImage: size },
      { width: size, height: size },
    );
  });
}

/** Alloue l'atlas des aperçus pour les couches de l'atlas couleur et le remplit depuis le sidecar. */
export function prepareWebgpuPreviewAtlas(
  device: GPUDevice,
  maps: readonly THREE.Texture[],
  textureIndices: Map<THREE.Texture, number> | undefined,
  previews: readonly TexturePreview[] | undefined,
): WebgpuPreviewAtlas {
  const layers = Math.max(2, maps.length + 1);
  const texture = device.createTexture({
    size: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, depthOrArrayLayers: layers },
    format: 'rgba8unorm-srgb',
    mipLevelCount: PREVIEW_LEVEL_SIZES.length,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const byTexture = new Map<number, TexturePreview>();
  for (const preview of previews ?? []) byTexture.set(preview.texture, preview);
  const white = whiteLevels();
  const flags = new Uint32Array(layers);
  // La couche 0 est le blanc définitif des matériaux sans texture : rien ne la transfère jamais.
  flags[0] = 1;
  let withPreview = 0;
  for (let layer = 1; layer < layers; layer++) {
    const map = maps[layer - 1] as THREE.Texture | undefined;
    const index = map ? textureIndices?.get(map) : undefined;
    const preview = index === undefined ? undefined : byTexture.get(index);
    if (preview) withPreview++;
    writeLayer(device, texture, layer, preview ? preview.levels : white);
  }
  writeLayer(device, texture, 0, white);
  const ready = device.createBuffer({
    size: Math.max(16, layers * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(ready, 0, flags);
  return {
    texture,
    view: texture.createView({ dimension: '2d-array' }),
    ready,
    withPreview,
    markReady(marked) {
      for (const layer of marked) {
        if (!Number.isInteger(layer) || layer < 1 || layer >= layers || flags[layer]) continue;
        flags[layer] = 1;
        device.queue.writeBuffer(ready, layer * 4, flags, layer, 1);
      }
    },
    destroy() {
      texture.destroy();
      ready.destroy();
    },
  };
}
