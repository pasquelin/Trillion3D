/**
 * Geometry of a texture's progressive pyramid, mirror of
 * `packages/asset-compiler-rust/src/texture_preview/levels.rs`.
 *
 * A level `k` is exactly mip level `k` of the source: both sides divided as
 * integers by `2^k`, never less than one texel. The engine therefore writes the received level `k`
 * into mip level `k` of its atlas layer, without recomputing anything. Nothing here reads the sidecar:
 * these functions re-derive an entry's geometry from its source dimensions alone, so the
 * reader can reject an entry whose written numbers disagree with them.
 */
/** Largest side a level carried by the sidecar may have. */
export const PREVIEW_BASE = 64;
/** Levels an entry carries at most: 64, 32, 16, 8, 4, 2, 1. */
export const PREVIEW_MAX_LEVELS = 7;

/** Dimensions of level `level` of a `width`×`height` image. */
export function previewLevelSize(width: number, height: number, level: number): [number, number] {
  const shift = Math.min(level, 31);
  return [Math.max(1, width >>> shift), Math.max(1, height >>> shift)];
}

/** Finest level carried: the first of which neither side exceeds `PREVIEW_BASE`. */
export function previewFirstLevel(width: number, height: number) {
  let level = 0;
  while (level < 31) {
    const [w, h] = previewLevelSize(width, height, level);
    if (w <= PREVIEW_BASE && h <= PREVIEW_BASE) break;
    level++;
  }
  return level;
}

/** Last level carried: the one where both sides are one texel. */
export function previewLastLevel(width: number, height: number) {
  return 31 - Math.clz32(Math.max(1, width, height));
}

/** Levels carried by an entry, from the finest to 1×1 included. */
export function previewLevelCount(width: number, height: number) {
  return previewLastLevel(width, height) - previewFirstLevel(width, height) + 1;
}

/**
 * Full geometry of an entry: its first carried level, their count and their RGBA8 bytes.
 * All three are deduced from the same two bounds. Asking for them one by one used to recompute
 * `previewFirstLevel` three times and `previewLastLevel` twice for the same dimensions, and
 * `previewFirstLevel` loops up to thirty-one times.
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

/** RGBA8 bytes of every carried level, concatenated from finest to coarsest. */
export function previewPixelBytes(width: number, height: number) {
  return previewGeometry(width, height).pixelBytes;
}

/**
 * True when everything that exceeds the sidecar tail is baked — including when nothing exceeds it,
 * the source fitting under `PREVIEW_BASE`. Such a chain is self-sufficient: the engine does not need
 * the source image. This is the only read of `bakedLevels` against the repo's `firstLevel`.
 */
export function previewIsWhole(preview: { firstLevel: number; bakedLevels: number }) {
  return preview.bakedLevels === preview.firstLevel;
}
