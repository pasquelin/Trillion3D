import type { Scene, Surface } from '../scene/experimentScene.ts';
import { fail } from './validation.ts';
import { crossVector3, dotVector3 } from '../../math/primitives/vector.ts';
export const EPSILON = 1e-7;
export const SURFACE_STRIDE = 15;

/** Return surface geometry in a fixed buffer, including the inverse Gram matrix for skew rectangles. */
export function packSurface(surface: Surface, output: Float64Array, offset: number): boolean {
  const u = surface.u,
    v = surface.v;
  const uu = dotVector3(u, u);
  const uv = dotVector3(u, v);
  const vv = dotVector3(v, v);
  const determinant = uu * vv - uv * uv;
  if (!(determinant > 1e-15)) fail('INVALID_SCENE', 'Surface rectangle is degenerate');
  const values = [
    ...surface.origin,
    ...u,
    ...v,
    ...crossVector3([0, 0, 0], u, v),
    vv / determinant,
    -uv / determinant,
    uu / determinant,
  ];
  let changed = false;
  for (let i = 0; i < SURFACE_STRIDE; i++) {
    changed ||= output[offset + i] !== values[i];
    output[offset + i] = values[i];
  }
  return changed;
}

/** scratch = distance, surface-u, surface-v, front-side flag. */
export function intersectSurface(
  packed: Float64Array,
  offset: number,
  rays: Float64Array,
  ray: number,
  limit: number,
  scratch: Float64Array,
): boolean {
  const ox = rays[ray],
    oy = rays[ray + 1],
    oz = rays[ray + 2];
  const dx = rays[ray + 3],
    dy = rays[ray + 4],
    dz = rays[ray + 5];
  const nx = packed[offset + 9],
    ny = packed[offset + 10],
    nz = packed[offset + 11];
  const denominator = nx * dx + ny * dy + nz * dz;
  if (Math.abs(denominator) < 1e-12) return false;
  const t =
    (nx * (packed[offset] - ox) + ny * (packed[offset + 1] - oy) + nz * (packed[offset + 2] - oz)) /
    denominator;
  if (!(t > EPSILON && t < limit)) return false;
  const x = ox + t * dx - packed[offset],
    y = oy + t * dy - packed[offset + 1],
    z = oz + t * dz - packed[offset + 2];
  const du = x * packed[offset + 3] + y * packed[offset + 4] + z * packed[offset + 5];
  const dv = x * packed[offset + 6] + y * packed[offset + 7] + z * packed[offset + 8];
  const a = packed[offset + 12] * du + packed[offset + 13] * dv;
  const b = packed[offset + 13] * du + packed[offset + 14] * dv;
  if (a < 0 || a > 1 || b < 0 || b > 1) return false;
  scratch[0] = t;
  scratch[1] = a;
  scratch[2] = b;
  scratch[3] = denominator < 0 ? 1 : 0;
  return true;
}

export function intersectSphere(
  scene: Scene,
  rays: Float64Array,
  ray: number,
  limit: number,
): number {
  if (!scene.sphere) return limit;
  const { center, radius } = scene.sphere;
  const x = rays[ray] - center[0],
    y = rays[ray + 1] - center[1],
    z = rays[ray + 2] - center[2];
  const b = x * rays[ray + 3] + y * rays[ray + 4] + z * rays[ray + 5];
  const discriminant = b * b - (x * x + y * y + z * z - radius * radius);
  if (discriminant < 0) return limit;
  const root = Math.sqrt(discriminant);
  let t = -b - root;
  if (t <= EPSILON) t = -b + root;
  return t > EPSILON && t < limit ? t : limit;
}
