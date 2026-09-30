import { hizLevelSizes } from './levelSizes.ts';

/** A packed pyramid's mip sizes, each mip's first texel and its whole size in bytes. */
export function pyramidBytes(width: number, height: number) {
  const sizes = hizLevelSizes(width, height);
  const offsets: number[] = [];
  let texels = 0;
  for (const [w, h] of sizes) {
    offsets.push(texels);
    texels += w * h;
  }
  return { sizes, offsets, texels, bytes: Math.max(4, texels * 4) };
}
