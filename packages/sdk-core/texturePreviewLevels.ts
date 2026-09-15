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

/** Octets RGBA8 de tous les niveaux portés, bout à bout du plus fin au plus grossier. */
export function previewPixelBytes(width: number, height: number) {
  let bytes = 0;
  const last = previewLastLevel(width, height);
  for (let level = previewFirstLevel(width, height); level <= last; level++) {
    const [w, h] = previewLevelSize(width, height, level);
    bytes += w * h * 4;
  }
  return bytes;
}
