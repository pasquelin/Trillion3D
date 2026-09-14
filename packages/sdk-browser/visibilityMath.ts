import * as THREE from 'three';
import { projectVisibilityVertex, type Projected } from './visibilityProjection.ts';
import { textureRgba, type VisPage } from './visibilityTypes.ts';

export function backgroundRgb(background: number) {
  return [(background >> 16) & 255, (background >> 8) & 255, background & 255];
}

export function triangleAt(
  page: VisPage,
  triangleIndex: number,
  viewProj: THREE.Matrix4,
  width: number,
  height: number,
) {
  const index = page.array,
    position = page.attributes.position,
    base = triangleIndex * 3;
  if (!position || base + 2 >= index.length) return null;
  const a = projectVisibilityVertex(page.matrix, position, index[base], viewProj, width, height);
  const b = projectVisibilityVertex(
    page.matrix,
    position,
    index[base + 1],
    viewProj,
    width,
    height,
  );
  const c = projectVisibilityVertex(
    page.matrix,
    position,
    index[base + 2],
    viewProj,
    width,
    height,
  );
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
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (area === 0) return null;
  const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area,
    w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area,
    w2 = 1 - w0 - w1;
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

export function wrapTexel(t: number, size: number, wrap: THREE.Wrapping) {
  const scaled =
    wrap === THREE.ClampToEdgeWrapping ? Math.min(1, Math.max(0, t)) : t - Math.floor(t);
  return Math.min(size - 1, Math.max(0, Math.floor(scaled * size)));
}

function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgb8(c: number) {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

function sampleTexel(
  map: THREE.Texture,
  u: number,
  v: number,
): [number, number, number, number] | null {
  const image = textureRgba(map);
  if (!image) return null;
  const x = wrapTexel(u, image.width, map.wrapS),
    y = wrapTexel(v, image.height, map.wrapT),
    i = (y * image.width + x) * 4,
    d = image.data;
  return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255];
}
export function sampleMap(map: THREE.Texture, u: number, v: number): [number, number, number] {
  const texel = sampleTexel(map, u, v);
  if (!texel) return [1, 1, 1];
  return [srgbToLinear(texel[0]), srgbToLinear(texel[1]), srgbToLinear(texel[2])];
}
export function sampleLinear(map: THREE.Texture, u: number, v: number): [number, number, number] {
  const texel = sampleTexel(map, u, v);
  if (!texel) return [1, 1, 1];
  return [texel[0], texel[1], texel[2]];
}

export function clusterHash(id: string) {
  return Array.from(id).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0);
}

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
