import type { HostAttribute } from '../../../../packages/sdk-browser/src/host/resources.ts'
import { srgbToLinear, type Texture } from '../../../../packages/sdk-core/src/index.ts'
import { mapTexel } from '../../../../packages/sdk-browser/src/visibility/math.ts'
import { signedArea, type Projected } from './projection.ts'
import { textureRgba } from '../../../../packages/sdk-browser/src/visibility/types.ts'

/** A colour byte times its alpha byte, as an 8-bit `premultiplyAlpha` upload stores it: the rule
 *  the GPU texel turn applies in integers (`webgpu/tile/texelTurn.ts`). */
export const premultipliedByte = (byte: number, alpha: number) => Math.round((byte * alpha) / 255)

// The CPU image's reads of a page: the oracle's, not the engine's. The colour of a pixel is the
// GPU's, and these are what it is checked against.

export function backgroundRgb(background: number) {
  return [(background >> 16) & 255, (background >> 8) & 255, background & 255]
}

type ScreenPoint = { x: number; y: number }
/**
 * The three affine barycentric weights of the point `(x, y)`, the signed area already known.
 *
 * The result is a work object reused from one call to the next: a raster reads it per pixel, and
 * allocating three numbers per pixel would cost more than the computation itself. The caller reads
 * it before the next call, or copies its fields, as `barycentric` does.
 */
const weights = { w0: 0, w1: 0, w2: 0 }
export function barycentricAt(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  x: number,
  y: number,
  area: number,
) {
  weights.w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area
  weights.w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area
  weights.w2 = 1 - weights.w0 - weights.w1
  return weights
}

export function barycentric(a: Projected, b: Projected, c: Projected, x: number, y: number) {
  const area = signedArea(a, b, c)
  if (area === 0) return null
  const { w0, w1, w2 } = barycentricAt(a, b, c, x, y, area)
  if (w0 < 0 || w1 < 0 || w2 < 0) return null
  return { w0, w1, w2, area }
}

export function attr2(
  attribute: HostAttribute | undefined,
  i0: number,
  i1: number,
  i2: number,
  w0: number,
  w1: number,
  w2: number,
): [number, number] {
  if (!attribute) return [0, 0]
  return [
    attribute.getX(i0) * w0 + attribute.getX(i1) * w1 + attribute.getX(i2) * w2,
    attribute.getY(i0) * w0 + attribute.getY(i1) * w1 + attribute.getY(i2) * w2,
  ]
}

/** sRGB → linear has only 256 possible antecedents: a texture byte divided by 255. The table
 *  carries exactly the values the per-pixel computation produced, on the same operands. */
const SRGB8_LINEAR = new Float64Array(256)
for (let octet = 0; octet < 256; octet++) SRGB8_LINEAR[octet] = srgbToLinear(octet / 255)

/** The colour of the texel a map reads, bytes as both GPU paths upload them — times their alpha
 *  under `premultiplyAlpha` (an alpha of 255 leaves them as they are) —, each read through `of`. */
function sampled(map: Texture, u: number, v: number, of: (byte: number) => number) {
  const image = textureRgba(map)
  if (!image) return [1, 1, 1] as [number, number, number]
  const d = image.data,
    i = mapTexel(image, map, u, v),
    a = map.premultiplyAlpha ? d[i + 3] : 255
  return [
    of(premultipliedByte(d[i], a)),
    of(premultipliedByte(d[i + 1], a)),
    of(premultipliedByte(d[i + 2], a)),
  ] as [number, number, number]
}
const srgbByte = (byte: number) => SRGB8_LINEAR[byte] ?? NaN,
  linearByte = (byte: number) => byte / 255
export const sampleMap = (map: Texture, u: number, v: number) => sampled(map, u, v, srgbByte)
export const sampleLinear = (map: Texture, u: number, v: number) => sampled(map, u, v, linearByte)
