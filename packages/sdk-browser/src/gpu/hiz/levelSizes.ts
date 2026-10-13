import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

/**
 * The sizes of a Hi-Z pyramid: the ceiling chain, each level `ceilDiv(side, 2)` of the one above
 * down to 1×1, so no texel of the finer level is left out of a coarser one. It is not the mip
 * rule `mipSize` (`../../../../math/src/scalar/integers.ts`), which floors and shrinks a side to
 * one texel at most; this chain is the rule of this pyramid alone, and this function its one home.
 */
export function hizLevelSizes(width: number, height: number): Array<[number, number]> {
  if (width < 1 || height < 1) throw new Error('HIZ_DEPTH_SIZE')
  const sizes: Array<[number, number]> = [[width, height]]
  while (sizes[sizes.length - 1][0] > 1 || sizes[sizes.length - 1][1] > 1) {
    const [w, h] = sizes[sizes.length - 1]
    sizes.push([ceilDiv(w, 2), ceilDiv(h, 2)])
  }
  return sizes
}
