import assert from 'node:assert/strict';
import type { Scene, Vec3 } from '../../packages/sdk-core/lightingExperimentScene.ts';

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
export const close = (actual: number, expected: number): void =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

// Independent rectangle visibility oracle: testing the fixture before transport approximation.
export function firstHit(scene: Scene, origin: Vec3, direction: Vec3): string | undefined {
  let distance = Infinity,
    id: string | undefined;
  for (const surface of scene.surfaces) {
    const normal = unit(cross(surface.u, surface.v)),
      denominator = dot(direction, normal);
    if (Math.abs(denominator) < 1e-10) continue;
    const t = dot(sub(surface.origin, origin), normal) / denominator;
    if (t <= 1e-7 || t >= distance) continue;
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
      id = surface.id;
    }
  }
  return id;
}
