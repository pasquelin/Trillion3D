/** What the aircraft specs share: the part shorthand, surfaces, lights, gear and outlines. */
import type { Vec3 } from '../plan/contract.ts';
import type { PropLamp } from './lamps.ts';
import { SURFACES } from './surfaces.ts';
import type { VehiclePart, WheelAnchor } from './vehicle-spec.ts';

/** Lathes and cylinders stand along Y: this turns them along +Z (nose-ward). */
export const ALONG_Z: Vec3 = [Math.PI / 2, 0, 0];
/** Extrudes lie in XY, depth along Z: this lays a planform flat (outline y → +Z, depth → Y). */
export const FLAT: Vec3 = [Math.PI / 2, 0, 0];
/** This stands a side outline upright (outline x → +Z, depth → X), like a fin. */
export const UPRIGHT: Vec3 = [0, -Math.PI / 2, 0];

export const part = (
  shape: VehiclePart['shape'],
  size: Vec3,
  position: Vec3,
  surface: string,
  more: Partial<VehiclePart> = {},
): VehiclePart => ({ shape, size, position, surface, ...more });

export const COMMON = {
  tyre: SURFACES.rubber,
  rim: SURFACES.steel,
  glass: SURFACES.glass,
  metal: SURFACES.steel,
  trim: SURFACES.darkMetal,
  portLight: SURFACES.signalRed,
  starboardLight: SURFACES.signalGreen,
};

/** A forward landing light, ≈ 400 000 cd in a narrow beam. */
export const landingLight = (id: string, offset: Vec3): PropLamp => ({
  id,
  type: 'spot',
  offset,
  direction: [0, -0.1, 1],
  cone: 0.25,
  color: [1, 0.97, 0.9],
  intensity: 400000,
  range: 400,
  night: true,
});

export const wheel = (
  position: Vec3,
  radius: number,
  width: number,
  steers: boolean,
): WheelAnchor => ({
  position,
  radius,
  width,
  steers,
  drives: false,
});

/**
 * One gear leg: a strut from `mount` down to the axle, and `tyres` side by side on the axle,
 * each a tyre and a hub turning with anchor `anchor`.
 */
export function gear(w: WheelAnchor, anchor: number, mount: number, tyres = 1): VehiclePart[] {
  const [x, y, z] = w.position,
    spacing = w.width * 1.25,
    parts: VehiclePart[] = [
      part('cylinder', [0.18, mount - y, 0.18], [x, (mount + y) / 2, z], 'metal', { segments: 16 }),
    ];
  for (let t = 0; t < tyres; t++) {
    const at: Vec3 = [x + (t - (tyres - 1) / 2) * spacing, y, z],
      common = { role: 'wheel' as const, anchor, segments: 40 };
    parts.push(
      part('torus', [2 * w.radius, w.width, 2 * w.radius], at, 'tyre', {
        rotation: [0, 0, Math.PI / 2],
        ...common,
      }),
      part('cylinder', [w.radius * 1.3, w.width * 0.9, w.radius * 1.3], at, 'rim', {
        rotation: [0, 0, Math.PI / 2],
        ...common,
      }),
    );
  }
  return parts;
}

/** A polygon whose corners stay crisp under Chaikin smoothing: each corner is split in two. */
export function crisp(points: readonly (readonly [number, number])[], cut: number) {
  return points.flatMap((p, i) => {
    const prev = points[(i + points.length - 1) % points.length],
      next = points[(i + 1) % points.length],
      toward = (q: readonly [number, number]) => {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1,
          s = Math.min(cut, d / 3) / d;
        return [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s] as const;
      };
    return [toward(prev), toward(next)];
  });
}
