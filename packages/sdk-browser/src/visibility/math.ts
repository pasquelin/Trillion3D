import type { HostAttribute } from '../host/resources.ts';
import { srgbToLinear, type Texture, type WrapMode } from '../../../sdk-core/src/index.ts';
import { uvTransformed } from '../../../sdk-core/src/texture/contract.ts';
import type { Projected } from './projection.ts';
import { barycentricAt, signedArea } from './projection.ts';
import { textureRgba } from './types.ts';

export function backgroundRgb(background: number) {
  return [(background >> 16) & 255, (background >> 8) & 255, background & 255];
}

export function barycentric(a: Projected, b: Projected, c: Projected, x: number, y: number) {
  const area = signedArea(a, b, c);
  if (area === 0) return null;
  const { w0, w1, w2 } = barycentricAt(a, b, c, x, y, area);
  if (w0 < 0 || w1 < 0 || w2 < 0) return null;
  return { w0, w1, w2, area };
}

export function perspectiveBary(
  a: Projected,
  b: Projected,
  c: Projected,
  affine: { w0: number; w1: number; w2: number },
) {
  const a0 = affine.w0 * a.invW,
    a1 = affine.w1 * b.invW,
    a2 = affine.w2 * c.invW,
    sum = a0 + a1 + a2;
  if (sum === 0) return affine;
  return { w0: a0 / sum, w1: a1 / sum, w2: a2 / sum };
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
  if (!attribute) return [0, 0];
  return [
    attribute.getX(i0) * w0 + attribute.getX(i1) * w1 + attribute.getX(i2) * w2,
    attribute.getY(i0) * w0 + attribute.getY(i1) * w1 + attribute.getY(i2) * w2,
  ];
}

/** Texel of an axis by the sampler's integer rule: mirror folds two periods. */
export function wrapTexel(t: number, size: number, wrap: WrapMode) {
  const p = wrap === 'mirror' ? 2 : 1;
  const scaled = wrap === 'clamp' ? Math.min(1, Math.max(0, t)) : t - p * Math.floor(t / p);
  const i = Math.floor(scaled * size);
  return Math.min(size - 1, Math.max(0, i < size ? i : 2 * size - 1 - i));
}

/** sRGB → linear has only 256 possible antecedents: a texture byte divided by 255. The table
 *  carries exactly the values the per-pixel computation produced, on the same operands. */
const SRGB8_LINEAIRE = new Float64Array(256);
for (let octet = 0; octet < 256; octet++) SRGB8_LINEAIRE[octet] = srgbToLinear(octet / 255);

export { linearToSrgb8 } from '../../../sdk-core/src/math/primitives/color.ts';
/** The projected triangle of a page, which the projection owns (`./projection.ts`). */
export { triangleAt } from './projection.ts';

/**
 * Rank of the texel a map reads at a coordinate, not its components: that byte indexes the sRGB
 * table. The coordinate goes through the map's UV transform first — its affine part, as both GPU
 * paths apply it —, untouched when it is the identity (`transformed`, which a caller reading many
 * texels of one map computes once). No footprint here: the texel the coordinate falls in, the
 * `nearest` rule. A `flipY` map reads its rows from the last, as both GPU paths upload them.
 */
export function mapTexel(
  image: { width: number; height: number },
  map: Texture,
  u: number,
  v: number,
  transformed = uvTransformed(map.transform),
) {
  const m = map.transform;
  let u2 = u,
    v2 = v;
  if (transformed) {
    u2 = m[0] * u + m[3] * v + m[6];
    v2 = m[1] * u + m[4] * v + m[7];
  }
  const x = wrapTexel(u2, image.width, map.wrapS),
    row = wrapTexel(v2, image.height, map.wrapT),
    y = map.flipY ? image.height - 1 - row : row;
  return (y * image.width + x) * 4;
}

/** A colour byte times its alpha byte, as an 8-bit `premultiplyAlpha` upload stores it. */
export const premultipliedByte = (byte: number, alpha: number) => Math.round((byte * alpha) / 255);

/** The colour of the texel a map reads, bytes as both GPU paths upload them — times their alpha
 *  under `premultiplyAlpha` (an alpha of 255 leaves them as they are) —, each read through `of`. */
function sampled(map: Texture, u: number, v: number, of: (byte: number) => number) {
  const image = textureRgba(map);
  if (!image) return [1, 1, 1] as [number, number, number];
  const d = image.data,
    i = mapTexel(image, map, u, v),
    a = map.premultiplyAlpha ? d[i + 3] : 255;
  return [
    of(premultipliedByte(d[i], a)),
    of(premultipliedByte(d[i + 1], a)),
    of(premultipliedByte(d[i + 2], a)),
  ] as [number, number, number];
}
const srgbByte = (byte: number) => SRGB8_LINEAIRE[byte] ?? NaN,
  linearByte = (byte: number) => byte / 255;
export const sampleMap = (map: Texture, u: number, v: number) => sampled(map, u, v, srgbByte);
export const sampleLinear = (map: Texture, u: number, v: number) => sampled(map, u, v, linearByte);

/** ×31 polynomial by code points. `hashId` (../diagnostic/colors.ts) walks UTF-16 units: same
 *  polynomial, two walks, two results outside the BMP — not two copies of one. */
export function clusterHash(id: string) {
  return Array.from(id).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0);
}

/** CPU mirror of the shaders' UV derivatives (`UV_GRADIENTS_WGSL`, `shader/pageWgsl.ts`): same
 *  quotients, same order, two languages — the text is not shared between TypeScript and WGSL. */
export function uvDerivatives(
  a: Projected,
  b: Projected,
  c: Projected,
  uva: [number, number],
  uvb: [number, number],
  uvc: [number, number],
  x: number,
  y: number,
) {
  const dxb = b.x - a.x,
    dyb = b.y - a.y,
    dxc = c.x - a.x,
    dyc = c.y - a.y,
    det = dxb * dyc - dxc * dyb;
  if (det === 0) return { duDx: 0, dvDx: 0, duDy: 0, dvDy: 0 };
  const inv = 1 / det,
    dsdx = dyc * inv,
    dsdy = -dxc * inv,
    dtdx = -dyb * inv,
    dtdy = dxb * inv;
  const s = ((x - a.x) * dyc - (y - a.y) * dxc) * inv,
    t = ((y - a.y) * dxb - (x - a.x) * dyb) * inv,
    a0 = 1 - s - t;
  const iw0 = a.invW,
    iw1 = b.invW,
    iw2 = c.invW;
  const Uu = a0 * uva[0] * iw0 + s * uvb[0] * iw1 + t * uvc[0] * iw2,
    Uv = a0 * uva[1] * iw0 + s * uvb[1] * iw1 + t * uvc[1] * iw2,
    W = a0 * iw0 + s * iw1 + t * iw2;
  if (W === 0) return { duDx: 0, dvDx: 0, duDy: 0, dvDy: 0 };
  const dUuds = -uva[0] * iw0 + uvb[0] * iw1,
    dUudt = -uva[0] * iw0 + uvc[0] * iw2,
    dUvds = -uva[1] * iw0 + uvb[1] * iw1,
    dUvdt = -uva[1] * iw0 + uvc[1] * iw2;
  const dWds = -iw0 + iw1,
    dWdt = -iw0 + iw2;
  const dUudx = dUuds * dsdx + dUudt * dtdx,
    dUudy = dUuds * dsdy + dUudt * dtdy,
    dUvdx = dUvds * dsdx + dUvdt * dtdx,
    dUvdy = dUvds * dsdy + dUvdt * dtdy;
  const dWdx = dWds * dsdx + dWdt * dtdx,
    dWdy = dWds * dsdy + dWdt * dtdy,
    invW2 = 1 / (W * W);
  return {
    duDx: (dUudx * W - Uu * dWdx) * invW2,
    dvDx: (dUvdx * W - Uv * dWdx) * invW2,
    duDy: (dUudy * W - Uu * dWdy) * invW2,
    dvDy: (dUvdy * W - Uv * dWdy) * invW2,
  };
}
