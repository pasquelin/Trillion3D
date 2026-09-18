/**
 * Géométrie de la pyramide progressive d'une texture, miroir de
 * `packages/asset-compiler-rust/src/texture_preview/levels.rs`.
 *
 * Un niveau `k` est exactement le niveau de mip `k` de la source : ses deux côtés divisés en
 * entiers par `2^k`, jamais moins d'un texel. Le moteur écrit donc le niveau `k` reçu dans le
 * niveau de mip `k` de sa couche d'atlas, sans rien recalculer. Rien ici ne lit le sidecar : ces
 * fonctions redéduisent la géométrie d'une entrée de ses seules dimensions source, ce qui permet au
 * lecteur de refuser une entrée dont les nombres écrits ne s'accordent pas avec elles.
 */
/** Plus grand côté qu'un niveau porté par le sidecar peut avoir. */
export const PREVIEW_BASE = 64;
/** Niveaux qu'une entrée porte au plus : 64, 32, 16, 8, 4, 2, 1. */
export const PREVIEW_MAX_LEVELS = 7;

/** Dimensions du niveau `level` d'une image `width`×`height`. */
export function previewLevelSize(width: number, height: number, level: number): [number, number] {
  const shift = Math.min(level, 31);
  return [Math.max(1, width >>> shift), Math.max(1, height >>> shift)];
}

/** Niveau le plus fin porté : le premier dont aucun côté ne dépasse `PREVIEW_BASE`. */
export function previewFirstLevel(width: number, height: number) {
  let level = 0;
  while (level < 31) {
    const [w, h] = previewLevelSize(width, height, level);
    if (w <= PREVIEW_BASE && h <= PREVIEW_BASE) break;
    level++;
  }
  return level;
}

/** Dernier niveau porté : celui où les deux côtés valent un texel. */
export function previewLastLevel(width: number, height: number) {
  return 31 - Math.clz32(Math.max(1, width, height));
}

/** Niveaux portés par une entrée, du plus fin au 1×1 compris. */
export function previewLevelCount(width: number, height: number) {
  return previewLastLevel(width, height) - previewFirstLevel(width, height) + 1;
}

/**
 * Géométrie complète d'une entrée : son premier niveau porté, leur nombre et leurs octets RGBA8.
 * Les trois se déduisent des deux mêmes bornes. Les demander une à une recalculait `previewFirstLevel`
 * trois fois et `previewLastLevel` deux fois pour les mêmes dimensions, et `previewFirstLevel` boucle
 * jusqu'à trente et une fois.
 */
export function previewGeometry(width: number, height: number) {
  const firstLevel = previewFirstLevel(width, height),
    lastLevel = previewLastLevel(width, height);
  let pixelBytes = 0;
  for (let level = firstLevel; level <= lastLevel; level++) {
    const [w, h] = previewLevelSize(width, height, level);
    pixelBytes += w * h * 4;
  }
  return { firstLevel, levelCount: lastLevel - firstLevel + 1, pixelBytes };
}

/** Octets RGBA8 de tous les niveaux portés, bout à bout du plus fin au plus grossier. */
export function previewPixelBytes(width: number, height: number) {
  return previewGeometry(width, height).pixelBytes;
}

/**
 * Vrai quand tout ce qui dépasse la queue du sidecar est cuit — y compris quand rien ne la dépasse,
 * la source tenant sous `PREVIEW_BASE`. Une telle chaîne se suffit : le moteur n'a pas besoin de
 * l'image source. C'est l'unique lecture de `bakedLevels` contre `firstLevel` du dépôt.
 */
export function previewIsWhole(preview: { firstLevel: number; bakedLevels: number }) {
  return preview.bakedLevels === preview.firstLevel;
}
