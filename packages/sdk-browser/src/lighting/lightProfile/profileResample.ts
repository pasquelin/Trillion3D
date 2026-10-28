import { fromHalf, toHalf } from '../../../../math/src/float/half.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/**
 * A profile's texels (half floats, `from` along a side) laid on a square of `to` texels a side, as the atlas takes a
 * profile of another size in: each texel of the result is the source read at its centre, bilinear between the four
 * source texels about it and held to the edge.
 */
export function resampleProfile(texels: Uint16Array<ArrayBuffer>, from: number, to: number) {
  const source = Float32Array.from(texels, fromHalf)
  const out = new Uint16Array(to * to)
  const scale = from / to
  // The source texel row and column pairs about each result row and column, and the weight of the second.
  const at = (index: number) => {
    const position = (index + 0.5) * scale - 0.5
    const first = Math.floor(position)
    return [clamp(first, 0, from - 1), clamp(first + 1, 0, from - 1), position - first] as const
  }
  for (let y = 0; y < to; y++) {
    const [y0, y1, ty] = at(y)
    for (let x = 0; x < to; x++) {
      const [x0, x1, tx] = at(x)
      const top = source[y0 * from + x0] * (1 - tx) + source[y0 * from + x1] * tx
      const bottom = source[y1 * from + x0] * (1 - tx) + source[y1 * from + x1] * tx
      out[y * to + x] = toHalf(top * (1 - ty) + bottom * ty)
    }
  }
  return out
}
