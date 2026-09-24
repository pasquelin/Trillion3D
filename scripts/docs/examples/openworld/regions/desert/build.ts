/**
 * What every placement step shares: the site, the lists it fills, and helpers to place a prop
 * with its lamps, to frame a road, and to aim a teleport.
 */
import type {
  LampLight,
  Marker,
  Mover,
  PropMesh,
  Road,
  Vec3,
  WorldPlan,
} from '../../plan/contract.ts';
import { placeLamps } from '../../props/index.ts';
import { PROP_LAMPS } from './catalog.ts';
import type { Point } from './geometry2.ts';
import type { PlaceOptions, Site } from './site.ts';
import { EYE } from '../../build/markers.ts';

export type Build = {
  plan: WorldPlan;
  site: Site;
  seed: number;
  /** Props made for one place only (the line's spans). */
  props: PropMesh[];
  lights: LampLight[];
  markers: Marker[];
  movers: Mover[];
  roads: Road[];
};

/** Places a prop and the lamps it carries; returns the instance or nothing. */
export function placeLit(
  b: Build,
  prop: string,
  x: number,
  z: number,
  yaw: number,
  options: PlaceOptions = {},
) {
  const instance = b.site.place(prop, x, z, yaw, options);
  const lamps = instance && PROP_LAMPS.get(prop);
  if (instance && lamps)
    b.lights.push(
      ...placeLamps(lamps, instance, instance.name ?? `${prop}@${Math.round(x)},${Math.round(z)}`),
    );
  return instance;
}

/** The yaw that turns a node's +Z (its front, a vehicle's nose, a view) toward (dx, dz). */
export const facing = (dx: number, dz: number) => Math.atan2(dx, dz);

/** A teleport at ground (x, z) looking toward `target`. */
export function teleport(
  b: Build,
  name: string,
  x: number,
  z: number,
  target: Point,
  pitch = -0.08,
): Marker {
  const marker: Marker = {
    kind: 'teleport',
    name,
    position: [x, b.plan.height(x, z) + EYE, z],
    yaw: facing(target[0] - x, target[1] - z),
    pitch,
  };
  b.markers.push(marker);
  return marker;
}

/** A point along a polyline by arc length, with its unit tangent. */
export type Station = { x: number; z: number; y: number; tx: number; tz: number };

export function along(points: readonly Vec3[], distance: number): Station {
  let left = distance;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay, az] = points[i],
      [bx, by, bz] = points[i + 1],
      length = Math.hypot(bx - ax, bz - az);
    if (left <= length || i + 2 === points.length) {
      const t = length ? Math.min(1, left / length) : 0;
      return {
        x: ax + (bx - ax) * t,
        z: az + (bz - az) * t,
        y: ay + (by - ay) * t,
        tx: (bx - ax) / length,
        tz: (bz - az) / length,
      };
    }
    left -= length;
  }
  const [x, y, z] = points[0];
  return { x, y, z, tx: 1, tz: 0 };
}

/** Horizontal length of a polyline. */
export const lengthOf = (points: readonly Vec3[]) =>
  points.reduce(
    (sum, p, i) => (i ? sum + Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]) : 0),
    0,
  );

/** A point `across` metres to the left of a station (its normal side) and `ahead` along it. */
export const offset = (s: Station, across: number, ahead = 0): Point => [
  s.x - s.tz * across + s.tx * ahead,
  s.z + s.tx * across + s.tz * ahead,
];
