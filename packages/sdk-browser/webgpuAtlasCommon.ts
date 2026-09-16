import type * as THREE from 'three';
import type { TexturePreview } from '../sdk-core/index.ts';
import { textureRgba } from './visibilityBuffer.ts';
import { generateMaterialMips, mipLevelCountFor } from './textureMips.ts';
import { planAtlasClasses, type AtlasClassPlan } from './webgpuAtlasClasses.ts';
import { previewLevelJobs, textureJobFor, type TextureJob } from './webgpuAtlasJobs.ts';

type AtlasFill = { r: number; g: number; b: number; a: number };

/** What distinguishes the sRGB colour atlas from the linear data atlas, plus the class bound. */
export type AtlasSpec = {
  kind: TextureJob['kind'];
  format: GPUTextureFormat;
  /** Classes de taille que l'hôte autorise : 1 rend l'allocation à une seule texture-tableau. */
  maxClasses: number;
  /** Remplissage d'une couche, par rang de la texture source, ou `undefined` pour le repli. */
  fillFor: (source: number | undefined) => AtlasFill;
  errorCode: string;
  /** Les niveaux progressifs d'une texture source, quand le sidecar en porte. */
  previewFor?: (index: number) => TexturePreview | undefined;
};

/** Une classe de taille allouée : sa texture-tableau, ses échelles uv par couche et ses octets. */
export type AtlasClassTexture = {
  texture: GPUTexture;
  view: GPUTextureView;
  size: [number, number];
  layers: number;
  bytes: number;
  scales: Array<[number, number]>;
};

export type WebgpuAtlas = {
  classes: AtlasClassTexture[];
  /** Classes réellement peuplées ; 1 vaut l'allocation unique d'avant ce lot. */
  used: number;
  /** Mot de slot de chaque texture, classe et couche empaquetées ; l'indice 0 est le repli. */
  slotWords: Uint32Array<ArrayBuffer>;
  /** Largeur en texels de la texture source de chaque slot : ce que l'écran compare à ses pixels
   *  pour nommer le niveau de mip utile. L'indice 0 est le remplissage, de largeur nulle. */
  texels: Float64Array;
  /** Octets alloués, calculés depuis les dimensions et les formats — jamais mesurés. */
  bytes: number;
  destroy(): void;
};

function clearWebgpuAtlasLayer(
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
  layer: number,
  color: AtlasFill,
) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: texture.createView({
          dimension: '2d',
          baseArrayLayer: layer,
          arrayLayerCount: 1,
          baseMipLevel: 0,
          mipLevelCount: 1,
        }),
        clearValue: color,
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.end();
}

/**
 * Regénère la chaîne de mips d'une classe : toutes ses couches, ou seulement celles données. Le
 * format, les dimensions et les échelles uv se lisent sur la classe, si bien qu'aucun appelant ne
 * redit l'ordre de ces six arguments.
 */
export function regenerateClassMips(
  device: GPUDevice,
  entry: AtlasClassTexture,
  layers?: readonly number[],
) {
  return generateMaterialMips(
    device,
    entry.texture,
    entry.texture.format,
    ...entry.size,
    entry.scales,
    layers,
  );
}

function allocate(
  device: GPUDevice,
  plan: AtlasClassPlan,
  format: GPUTextureFormat,
  encoder: GPUCommandEncoder,
  fillFor: (classIndex: number, layer: number) => AtlasFill,
): AtlasClassTexture[] {
  return plan.sizes.map(([width, height], index) => {
    const layers = plan.layers[index];
    const texture = device.createTexture({
      size: { width, height, depthOrArrayLayers: layers },
      format,
      mipLevelCount: mipLevelCountFor(width, height),
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    for (let layer = 0; layer < layers; layer++)
      clearWebgpuAtlasLayer(encoder, texture, layer, fillFor(index, layer));
    return {
      texture,
      view: texture.createView({ dimension: '2d-array' }),
      size: [width, height] as [number, number],
      layers,
      bytes: plan.bytes[index],
      scales: Array.from({ length: layers }, () => [1, 1] as [number, number]),
    };
  });
}

/**
 * Alloue les classes de taille d'un atlas de matériaux, efface chaque couche sur `encoder` et met
 * en file le transfert de chaque texture source : d'abord ses niveaux progressifs quand le sidecar
 * en porte, puis sa pleine résolution. La couche 0 de chaque classe reste le remplissage de repli.
 */
export function prepareWebgpuAtlas(
  device: GPUDevice,
  maps: THREE.Texture[],
  uvScales: Array<[number, number]>,
  textureJobs: TextureJob[],
  encoder: GPUCommandEncoder,
  spec: AtlasSpec,
): WebgpuAtlas {
  const rgbaMaps = maps.map((texture) => textureRgba(texture));
  const sizes = maps.map((texture, index): [number, number] => {
    const rgba = rgbaMaps[index];
    if (rgba) return [rgba.width, rgba.height];
    const image = texture.image as { width?: number; height?: number } | undefined;
    return [Math.max(1, image?.width ?? 1), Math.max(1, image?.height ?? 1)];
  });
  const plan = planAtlasClasses(device, sizes, spec.maxClasses);
  // Quelle texture source occupe quelle couche de quelle classe : le remplissage d'une couche se
  // décide par texture (une carte de normales part du normal plat), pas par rang de couche.
  const sourceAt: number[][] = plan.sizes.map(() => []);
  for (let index = 0; index < maps.length; index++)
    sourceAt[plan.slotClass[index]][plan.slotLayer[index]] = index;
  const classes = allocate(device, plan, spec.format, encoder, (classIndex, layer) =>
    spec.fillFor(sourceAt[classIndex][layer]),
  );
  const slotWords = new Uint32Array(maps.length + 1);
  const texels = new Float64Array(maps.length + 1);
  for (let index = 0; index < maps.length; index++) {
    const slot = index + 1,
      classIndex = plan.slotClass[index],
      layer = plan.slotLayer[index];
    const entry = classes[classIndex];
    slotWords[slot] = classIndex | (layer << 8);
    const place = { slot, classIndex, layer };
    const preview = spec.previewFor?.(index);
    if (preview)
      textureJobs.push(...previewLevelJobs({ device, texture: entry.texture, place, preview }));
    const { job, scale } = textureJobFor({
      device,
      texture: entry.texture,
      rgba: rgbaMaps[index],
      map: maps[index],
      place,
      kind: spec.kind,
      atlas: entry.size,
      errorCode: spec.errorCode,
    });
    uvScales[slot] = scale;
    texels[slot] = entry.size[0] * scale[0];
    entry.scales[layer] = scale;
    textureJobs.push(job);
  }
  return {
    classes,
    used: plan.used,
    slotWords,
    texels,
    bytes: plan.bytes.reduce((total, value) => total + value, 0),
    destroy() {
      for (const entry of classes) entry.texture.destroy();
    },
  };
}
