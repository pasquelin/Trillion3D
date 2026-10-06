import type { HizPyramid } from './types.ts'

/**
 * `hizOccluded(nearest, hizFootprintFarFlat(pyramid, x0, y0, x1 + 1, y1 + 1, level), bias)` for the
 * inclusive level-0 rectangle `[x0, x1]×[y0, y1]` inside the image, with the GPU twin's early exits
 * (`gpu/hiz/rectWgsl.ts`): `min(t) − bias` is `min(t − bias)` (subtraction rounds monotonically), so
 * the box is hidden when every texel hides it, decided at the first one that does not — NaN and
 * `−∞` never hide — and a footprint all `+∞` (a far of `+∞`, not finite) hides nothing. The level
 * where the rectangle spans at most 2×2 texels is tried first: each of its texels is the farthest of
 * a block holding the finer ones, so when they all hide, every finer one does.
 */
export function hizHides(
  pyramid: HizPyramid,
  level: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  nearest: number,
  bias = 0,
) {
  if (!Number.isFinite(nearest) || !Number.isFinite(bias) || bias < 0) return false
  let coarse = level
  while (
    coarse + 1 < pyramid.count &&
    ((x1 >> coarse) - (x0 >> coarse) > 1 || (y1 >> coarse) - (y0 >> coarse) > 1)
  )
    coarse++
  if (coarse > level && hides(pyramid, coarse, x0, y0, x1, y1, nearest, bias))
    return finite(pyramid, level, x0, y0, x1, y1)
  return (
    hides(pyramid, level, x0, y0, x1, y1, nearest, bias) && finite(pyramid, level, x0, y0, x1, y1)
  )
}

/** Whether every texel of `level` over the level-0 rectangle has `nearest < t − bias`. */
function hides(
  p: HizPyramid,
  level: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  nearest: number,
  bias: number,
) {
  for (let y = y0 >> level; y <= y1 >> level; y++)
    for (let x = x0 >> level, row = p.offsets[level] + y * p.widths[level]; x <= x1 >> level; x++)
      if (!(nearest < p.data[row + x] - bias)) return false
  return true
}

/** Whether a texel of `level` over the level-0 rectangle is not `+∞`. */
function finite(p: HizPyramid, level: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0 >> level; y <= y1 >> level; y++)
    for (let x = x0 >> level, row = p.offsets[level] + y * p.widths[level]; x <= x1 >> level; x++)
      if (p.data[row + x] !== Infinity) return true
  return false
}
