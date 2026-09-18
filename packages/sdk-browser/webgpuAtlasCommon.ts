import type * as THREE from 'three';
import type { TexturePreview } from '../sdk-core/index.ts';
import { textureRgba } from './visibilityBuffer.ts';
import { generateMaterialMips } from './textureMips.ts';
import { allocateAtlasClasses } from './webgpuAtlasAllocate.ts';
import { planAtlasClasses } from './webgpuAtlasClasses.ts';
import { previewLevelJobs, textureJobFor, type TextureJob } from './webgpuAtlasJobs.ts';
import { bakedLevelJobs } from './webgpuAtlasBakedJobs.ts';
import type { TextureLevelReader } from './textureLevelReader.ts';
import { previewIsWhole, previewLastLevel } from '../sdk-core/index.ts';

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
  /** Le lecteur des niveaux cuits ; sans lui, une chaîne cuite se charge comme avant, par la source. */
  readLevel?: TextureLevelReader;
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

/**
 * Alloue les classes de taille d'un atlas de matériaux, efface chaque couche sur `encoder` et met
 * en file le transfert de chaque texture source. Une texture dont la chaîne est cuite dans le cache
 * n'a rien à demander à l'image source : sa queue vient du sidecar, ses niveaux au-dessus se lisent
 * un à un quand l'écran les réclame, et la carte ne régénère rien. Les autres gardent le chemin
 * d'avant — queue du sidecar s'il y en a une, puis pleine résolution depuis l'image, puis
 * régénération des mips. La couche 0 de chaque classe reste le remplissage de repli.
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
  // Une chaîne entière se suffit : ses dimensions sont celles du manifeste, et l'image source, que
  // l'hôte a pu ne pas charger, n'est pas lue — pourvu qu'un lecteur existe pour ses niveaux cuits,
  // ou qu'elle n'en ait aucun, la source tenant sous la base.
  const previews = maps.map((_map, index) => spec.previewFor?.(index));
  const chains = previews.map((preview) =>
    preview && previewIsWhole(preview) && (preview.bakedLevels === 0 || spec.readLevel)
      ? preview
      : undefined,
  );
  const sizes = maps.map((texture, index): [number, number] => {
    const chain = chains[index];
    if (chain) return [chain.width, chain.height];
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
  const classes = allocateAtlasClasses(device, plan, spec.format, encoder, (classIndex, layer) =>
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
    const preview = previews[index],
      chain = chains[index];
    const last = preview ? previewLastLevel(preview.width, preview.height) : 0;
    const pyramid = chain ? { first: 0, last } : { first: preview?.firstLevel ?? 0, last };
    const common = { device, texture: entry.texture, place, kind: spec.kind, pyramid };
    if (preview) textureJobs.push(...previewLevelJobs({ ...common, preview }));
    let scale: [number, number];
    if (chain) {
      if (spec.readLevel)
        textureJobs.push(...bakedLevelJobs({ ...common, preview: chain, read: spec.readLevel }));
      scale = [chain.width / entry.size[0], chain.height / entry.size[1]];
    } else {
      const full = textureJobFor({
        device,
        texture: entry.texture,
        rgba: rgbaMaps[index],
        map: maps[index],
        place,
        kind: spec.kind,
        atlas: entry.size,
        errorCode: spec.errorCode,
      });
      scale = full.scale;
      textureJobs.push(full.job);
    }
    uvScales[slot] = scale;
    texels[slot] = entry.size[0] * scale[0];
    entry.scales[layer] = scale;
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
