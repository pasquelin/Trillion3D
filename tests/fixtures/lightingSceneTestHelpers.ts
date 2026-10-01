import assert from 'node:assert/strict';
import type { Scene, Vec3 } from '../../packages/sdk-core/src/lighting/scene/experimentScene.ts';

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const unit = (v: Vec3): Vec3 => {
  const size = Math.hypot(...v);
  return [v[0] / size, v[1] / size, v[2] / size];
};
/** The middle of a rectangle spanned by `u` and `v` from `origin`. */
export const centre = ({ origin, u, v }: { origin: Vec3; u: Vec3; v: Vec3 }): Vec3 => [
  origin[0] + (u[0] + v[0]) / 2,
  origin[1] + (u[1] + v[1]) / 2,
  origin[2] + (u[2] + v[2]) / 2,
];
export const close = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

// Independent rectangle visibility oracle: testing the fixture before transport approximation.
/** The nearest surface a ray meets: its index, the hit's surface coordinates and whether its front faces the ray. */
export function nearestHit(scene: Scene, origin: Vec3, direction: Vec3) {
  let distance = Infinity,
    hit: { surface: number; u: number; v: number; front: boolean } | undefined;
  scene.surfaces.forEach((surface, index) => {
    const normal = unit(cross(surface.u, surface.v)),
      denominator = dot(direction, normal);
    if (Math.abs(denominator) < 1e-10) return;
    const t = dot(sub(surface.origin, origin), normal) / denominator;
    if (t <= 1e-7 || t >= distance) return;
    const point: Vec3 = [
      origin[0] + t * direction[0],
      origin[1] + t * direction[1],
      origin[2] + t * direction[2],
    ];
    const local = sub(point, surface.origin);
    const u = dot(local, surface.u) / dot(surface.u, surface.u),
      v = dot(local, surface.v) / dot(surface.v, surface.v);
    if (u >= -1e-9 && u <= 1 + 1e-9 && v >= -1e-9 && v <= 1 + 1e-9) {
      distance = t;
      hit = { surface: index, u, v, front: denominator < 0 };
    }
  });
  return hit;
}

export function firstHit(scene: Scene, origin: Vec3, direction: Vec3): string | undefined {
  const hit = nearestHit(scene, origin, direction);
  return hit && scene.surfaces[hit.surface].id;
}
