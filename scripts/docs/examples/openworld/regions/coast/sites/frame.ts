/**
 * A local frame on the shore: `u` runs along the coast, `v` inland from the waterline. Beach,
 * pier and port lay their rows in it, then read the real ground under every point, so a curved
 * or sloping shore is followed, not assumed straight.
 */
import type { Vec3 } from '../../../plan/contract.ts';
import { yawToward } from './layout.ts';
import { waterline, type CoastMap, type Shore } from './map.ts';

export type ShoreFrame = {
  origin: Vec3;
  normal: readonly [number, number];
  /** Along the coast: the normal turned a quarter left. */
  tangent: readonly [number, number];
  /** Yaw that faces the sea. */
  seaward: number;
  at(u: number, v: number): [number, number];
  /** Where, walking inland at `u`, the ground first reaches `height` (within `limit` m). */
  inland(u: number, height: number, limit?: number): number | undefined;
};

/** The mean seaward normal of shore cells within `radius` of `s`, for a steadier frame. */
function meanNormal(map: CoastMap, s: Shore, radius: number): [number, number] {
  let x = 0,
    z = 0;
  for (const other of map.shores)
    if (other.island === s.island && Math.hypot(other.x - s.x, other.z - s.z) <= radius) {
      x += other.normal[0];
      z += other.normal[1];
    }
  const length = Math.hypot(x, z) || 1;
  return [x / length, z / length];
}

export function shoreFrame(map: CoastMap, s: Shore, radius = 250): ShoreFrame {
  const normal = meanNormal(map, s, radius),
    tangent: [number, number] = [-normal[1], normal[0]],
    origin = waterline(map, s.x, s.z, normal),
    at = (u: number, v: number): [number, number] => [
      origin[0] + tangent[0] * u - normal[0] * v,
      origin[2] + tangent[1] * u - normal[1] * v,
    ];
  return {
    origin,
    normal,
    tangent,
    seaward: yawToward(normal[0], normal[1]),
    at,
    inland(u, height, limit = 200) {
      for (let v = -40; v <= limit; v += 2) if (map.height(...at(u, v)) >= height) return v;
      return undefined;
    },
  };
}
