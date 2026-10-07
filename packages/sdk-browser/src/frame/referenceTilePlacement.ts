import { linearToSrgb8, srgbToLinear } from '../../../sdk-core/src/math/primitives/color.ts'
import type { ViewTile } from '../camera/engineCamera.ts'

/** One tile of the reference: where its pixels land in the output, and how the camera's
 *  projection is scaled and shifted to draw it (`ViewTile`). */
export interface ReferenceTile extends ViewTile {
  /** Output pixel origin of the tile, bottom row first. */
  x: number
  y: number
  /** Output pixels the tile covers. */
  width: number
  height: number
}

/** sRGB byte to linear light, once for the 256 values. */
const LINEAR = Float32Array.from({ length: 256 }, (_, byte) => srgbToLinear(byte / 255))

/**
 * The RGBA image `rgba` of `width` × `height`, box-filtered `factor` times per axis: each output
 * pixel is the mean of its `factor`² samples, colour in linear light and re-encoded to sRGB, alpha
 * as is. Rows keep their order (bottom first in, bottom first out); a remainder past a whole
 * block is left out.
 */
export function resolveSupersampled(
  rgba: Uint8Array,
  width: number,
  height: number,
  factor: number,
) {
  if (factor === 1) return rgba
  const w = Math.floor(width / factor),
    h = Math.floor(height / factor),
    samples = factor * factor
  const out = new Uint8Array(w * h * 4)
  const sum = new Float64Array(4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      sum.fill(0)
      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * width + x * factor + dx) * 4
          sum[0] += LINEAR[rgba[i]]
          sum[1] += LINEAR[rgba[i + 1]]
          sum[2] += LINEAR[rgba[i + 2]]
          sum[3] += rgba[i + 3]
        }
      const o = (y * w + x) * 4
      for (let c = 0; c < 3; c++) out[o + c] = linearToSrgb8(sum[c] / samples)
      out[o + 3] = Math.round(sum[3] / samples)
    }
  return out
}

/** Places a tile's resolved `width` × `height` pixels into `out`, a `imageWidth`-wide RGBA image
 *  bottom row first. */
export function placeTile(
  out: Uint8Array,
  imageWidth: number,
  tile: ReferenceTile,
  resolved: Uint8Array,
) {
  const stride = tile.width * 4
  for (let row = 0; row < tile.height; row++)
    out.set(
      resolved.subarray(row * stride, (row + 1) * stride),
      ((tile.y + row) * imageWidth + tile.x) * 4,
    )
}

/** Most tiles one reference image is drawn in: a cap on the work, not on the factor. */
export const REFERENCE_MAX_TILES = 64
