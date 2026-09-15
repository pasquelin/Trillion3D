import { mipLevelCountFor } from './textureMips.ts';

/**
 * Classes de taille d'un atlas de matériaux.
 *
 * Une texture-tableau impose une seule dimension à toutes ses couches : allouer toutes les couches
 * à la taille de la plus grande texture faisait payer à une texture de 64 px la place d'une texture
 * de 4 096. L'atlas est donc coupé en un petit nombre de classes, chacune sa propre texture-tableau,
 * dont les dimensions descendent par puissances de deux depuis celles de la plus grande texture.
 * Une texture va dans la plus petite classe qui la contient, elle et ses deux côtés.
 *
 * Le nombre de slots de liaison est fixe, pour que les dispositions et les shaders le soient aussi ;
 * il tient sous le minimum garanti par WebGPU, si bien qu'aucun appareil ne peut le refuser. Le
 * nombre de classes *employées*, lui, se décide à la préparation : une seule quand la scène ou les
 * limites de l'appareil ne permettent pas mieux, ce qui redonne exactement l'allocation d'avant.
 */
export const ATLAS_CLASS_COUNT = 2;
/** Divisions par deux explorées pour la classe la plus petite : 4 096 descend jusqu'à un texel. */
const MAX_CLASS_SHIFT = 12;
/** Octets par texel des deux formats alloués, `rgba8unorm-srgb` comme `rgba8unorm`. */
const BYTES_PER_TEXEL = 4;

export type AtlasClassPlan = {
  /** Dimensions et nombre de couches de chaque classe, la classe 0 portant la plus grande texture. */
  sizes: Array<[number, number]>;
  layers: number[];
  /** Classe et couche de chaque texture source, dans l'ordre où le collecteur les a trouvées. */
  slotClass: number[];
  slotLayer: number[];
  /** Classes réellement peuplées ; les suivantes sont des textures 1×1 que rien ne lit. */
  used: number;
  /** Octets alloués par classe, calculés depuis les dimensions et le format, jamais mesurés. */
  bytes: number[];
};

/** Octets d'une texture-tableau et de toute sa chaîne de mips, au format quatre octets par texel. */
function atlasClassBytes(width: number, height: number, layers: number) {
  let bytes = 0;
  for (let level = 0; level < mipLevelCountFor(width, height); level++)
    bytes += Math.max(1, width >> level) * Math.max(1, height >> level) * BYTES_PER_TEXEL * layers;
  return bytes;
}

const sum = (total: number, value: number) => total + value;

function assign(
  sizes: ReadonlyArray<readonly [number, number]>,
  classSizes: Array<[number, number]>,
  maxLayers: number,
) {
  // La couche 0 de chaque classe est son remplissage de repli : elle existe même sans texture.
  const counts = classSizes.map(() => 1);
  const slotClass: number[] = [],
    slotLayer: number[] = [];
  for (const [width, height] of sizes) {
    let chosen = 0;
    for (let index = classSizes.length - 1; index > 0; index--)
      if (width <= classSizes[index][0] && height <= classSizes[index][1]) {
        chosen = index;
        break;
      }
    slotClass.push(chosen);
    slotLayer.push(counts[chosen]++);
  }
  const layers = counts.map((count) => Math.max(2, count));
  if (layers.some((count) => count > maxLayers)) return undefined;
  const bytes = classSizes.map(([width, height], index) =>
    atlasClassBytes(width, height, layers[index]),
  );
  return { sizes: classSizes, layers, slotClass, slotLayer, bytes };
}

/**
 * Le découpage en classes qui alloue le moins d'octets, la classe 0 gardant les dimensions de la
 * plus grande texture. Rend toujours `ATLAS_CLASS_COUNT` classes : celles qu'aucune texture
 * n'emploie sont des textures 1×1 de deux couches, huit octets, que les shaders ne lisent jamais.
 */
export function planAtlasClasses(
  device: GPUDevice,
  sizes: ReadonlyArray<readonly [number, number]>,
): AtlasClassPlan {
  let width = 1,
    height = 1;
  for (const [w, h] of sizes) {
    width = Math.max(width, w);
    height = Math.max(height, h);
  }
  const maxLayers = device.limits.maxTextureArrayLayers;
  const sampled = device.limits.maxSampledTexturesPerShaderStage;
  // La passe de résolution lit le tampon de visibilité, puis autant d'atlas couleur que de données.
  const affordable = Math.max(1, Math.floor((sampled - 1) / 2));
  const allowed = Math.min(ATLAS_CLASS_COUNT, affordable);
  const single = assign(sizes, [[width, height]], maxLayers);
  if (!single)
    throw new Error(
      `TEXTURE_ATLAS_LAYERS: ${sizes.length + 1} texture layers exceed the device limit ${maxLayers}`,
    );
  let best = single;
  for (let shift = 1; allowed > 1 && shift <= MAX_CLASS_SHIFT; shift++) {
    const small: [number, number] = [Math.max(1, width >> shift), Math.max(1, height >> shift)];
    const candidate = assign(sizes, [[width, height], small], maxLayers);
    if (
      candidate &&
      candidate.bytes.reduce(sum) < best.bytes.reduce(sum) &&
      candidate.layers[1] > 2
    )
      best = candidate;
  }
  const used = best.sizes.length;
  const plan: AtlasClassPlan = { ...best, used };
  while (plan.sizes.length < ATLAS_CLASS_COUNT) {
    plan.sizes.push([1, 1]);
    plan.layers.push(2);
    plan.bytes.push(atlasClassBytes(1, 1, 2));
  }
  return plan;
}
