import type { NumberSink } from '../matrix/matrix4.ts'

/**
 * `out = W · m`, `W` the window transform of clip space `x' = sx·x + ox·w`, `y' = sy·y + oy·w`,
 * `z` and `w` kept: a scale and an offset of the picture in clip units, applied to a projection
 * or a view-projection. A sub-pixel jitter is `(1, 1, 2·jx / width, 2·jy / height)`; a tile of a
 * wider view its scale and its shift. Per column `c`, with `w = m[4c + 3]`:
 * `out[4c] = m[4c]·sx + ox·w`, `out[4c + 1] = m[4c + 1]·sy + oy·w`, rows 2 and 3 copied — the
 * value of the full product (`multiplyMatrix4(W, m)`) without its zero terms, so the depth rows
 * keep their bits. The four of a column are read before its write: `out` may be `m`. The scales
 * and offsets must be finite: a product `0 · ∞` would make the entry NaN.
 */
export function clipWindowMatrix4<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  sx: number,
  sy: number,
  ox: number,
  oy: number,
) {
  for (let c = 0; c < 16; c += 4) {
    const x = m[c],
      y = m[c + 1],
      z = m[c + 2],
      w = m[c + 3]
    out[c] = x * sx + ox * w
    out[c + 1] = y * sy + oy * w
    out[c + 2] = z
    out[c + 3] = w
  }
  return out
}
