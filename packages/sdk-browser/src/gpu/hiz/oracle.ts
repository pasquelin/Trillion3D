import { hizLevelSizes } from './levelSizes.ts'

/** A packed pyramid's mip sizes, each mip's first texel, its whole size in bytes, and how its texels
 *  divide: `first` at level 0, `upper` in the coarser levels. */
export function pyramidBytes(width: number, height: number) {
  const sizes = hizLevelSizes(width, height)
  const offsets: number[] = []
  let texels = 0
  for (const [w, h] of sizes) {
    offsets.push(texels)
    texels += w * h
  }
  const first = offsets.length > 1 ? offsets[1] : texels
  return { sizes, offsets, texels, bytes: Math.max(4, texels * 4), first, upper: texels - first }
}
