import * as THREE from 'three';
import { linearToSrgb, srgbToLinear } from '../sdk-core/index.ts';
import type { Projected } from './visibilityProjection.ts';
import type { DepthCamera } from './depthConvention.ts';
import { barycentricAt, projectVisibilityVertex, signedArea } from './visibilityProjection.ts';
import { textureRgba, type VisPage } from './visibilityTypes.ts';

export function backgroundRgb(background: number) {
  return [(background >> 16) & 255, (background >> 8) & 255, background & 255];
}

export function triangleAt(
  page: VisPage,
  triangleIndex: number,
  cam: DepthCamera,
  width: number,
  height: number,
) {
  const index = page.array,
    position = page.attributes.position,
    base = triangleIndex * 3;
  if (!position || base + 2 >= index.length) return null;
  const a = projectVisibilityVertex(page.matrix, position, index[base], cam, width, height);
  const b = projectVisibilityVertex(page.matrix, position, index[base + 1], cam, width, height);
  const c = projectVisibilityVertex(page.matrix, position, index[base + 2], cam, width, height);
  if (!a || !b || !c) return null;
  return {
    a,
    b,
    c,
    page,
    triangleIndex,
    i0: index[base],
    i1: index[base + 1],
    i2: index[base + 2],
  };
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
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
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

/** Le texel d'un axe par la règle entière de l'échantillonneur : le miroir replie deux périodes. */
export function wrapTexel(t: number, size: number, wrap: THREE.Wrapping) {
  const p = wrap === THREE.MirroredRepeatWrapping ? 2 : 1;
  const scaled =
    wrap === THREE.ClampToEdgeWrapping ? Math.min(1, Math.max(0, t)) : t - p * Math.floor(t / p);
  const i = Math.floor(scaled * size);
  return Math.min(size - 1, Math.max(0, i < size ? i : 2 * size - 1 - i));
}

/** sRGB → linéaire n'a que 256 antécédents possibles : un octet de texture divisé par 255. La table
 *  porte exactement les valeurs que le calcul par pixel produisait, sur les mêmes opérandes. */
const SRGB8_LINEAIRE = new Float64Array(256);
for (let octet = 0; octet < 256; octet++) SRGB8_LINEAIRE[octet] = srgbToLinear(octet / 255);

export function linearToSrgb8(c: number) {
  return Math.max(0, Math.min(255, Math.round(linearToSrgb(c) * 255)));
}

/** Le rang du texel dans l'image, pas ses composantes : c'est l'octet qui indexe la table sRGB. */
function texelAt(
  image: { width: number; height: number },
  map: THREE.Texture,
  u: number,
  v: number,
) {
  const x = wrapTexel(u, image.width, map.wrapS),
    y = wrapTexel(v, image.height, map.wrapT);
  return (y * image.width + x) * 4;
}

export function sampleMap(map: THREE.Texture, u: number, v: number): [number, number, number] {
  const image = textureRgba(map);
  if (!image) return [1, 1, 1];
  const d = image.data,
    i = texelAt(image, map, u, v);
  return [
    SRGB8_LINEAIRE[d[i]] ?? NaN,
    SRGB8_LINEAIRE[d[i + 1]] ?? NaN,
    SRGB8_LINEAIRE[d[i + 2]] ?? NaN,
  ];
}
export function sampleLinear(map: THREE.Texture, u: number, v: number): [number, number, number] {
  const image = textureRgba(map);
  if (!image) return [1, 1, 1];
  const d = image.data,
    i = texelAt(image, map, u, v);
  return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
}

/** Polynôme ×31 par points de code. `hashId` (backendCommon.ts) parcourt les unités UTF-16 : même
 *  polynôme, deux parcours, deux résultats hors du plan de base — pas deux copies d'un seul. */
export function clusterHash(id: string) {
  return Array.from(id).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0);
}

/** Miroir CPU des dérivées d'UV du nuanceur d'ombrage (`visibilityShaderShade.ts`) : mêmes
 *  quotients, même ordre, deux langages — le texte ne se partage pas entre TypeScript et WGSL. */
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
