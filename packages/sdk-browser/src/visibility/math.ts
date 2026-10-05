import type { Texture, WrapMode } from '../../../sdk-core/src/index.ts';
import { uvTransformed } from '../../../sdk-core/src/texture/contract.ts';
import type { Projected } from './projection.ts';

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

/** Texel of an axis by the sampler's integer rule: mirror folds two periods. */
export function wrapTexel(t: number, size: number, wrap: WrapMode) {
  const p = wrap === 'mirror' ? 2 : 1;
  const scaled = wrap === 'clamp' ? Math.min(1, Math.max(0, t)) : t - p * Math.floor(t / p);
  const i = Math.floor(scaled * size);
  return Math.min(size - 1, Math.max(0, i < size ? i : 2 * size - 1 - i));
}

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

/** ×31 polynomial by code points. `hashId` (../diagnostic/colors.ts) walks UTF-16 units: same
 *  polynomial, two walks, two results outside the BMP — not two copies of one. */
export function clusterHash(id: string) {
  return Array.from(id).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0);
}
