/**
 * What every region's tests check the same way: an output's bytes (to prove the same plan gives
 * the same region), a bounds test, every point an output places, and its forest patches.
 */
import { solidColliders } from '../build/colliders.ts';
import { crosses } from '../build/footprint.ts';
import { solidIndex } from '../build/solids.ts';
import type { Bounds, RegionOutput, Road, Vec3, WorldPlan } from '../plan/contract.ts';
import { forestStands, partBounds, sharedProps, STAND_SIDE } from '../props/index.ts';
import { segmentRect, type Rect } from './countryside/footprint.ts';
import { standOffsets } from './stands.ts';

/** Everything a region returns: its meshes as raw arrays, then the rest as JSON. */
export function outputBytes(out: RegionOutput): Buffer {
  const meshes = out.props.flatMap((p) =>
    p.parts.flatMap((part) =>
      [part.positions, part.normals ?? new Float32Array(), part.indices].map((a) =>
        Buffer.from(a.buffer, a.byteOffset, a.byteLength),
      ),
    ),
  );
  const rest = { ...out, props: out.props.map((p) => p.id) };
  return Buffer.concat([...meshes, Buffer.from(JSON.stringify(rest))]);
}

/** Whether a point's (x, z) lies inside `bounds`, edges included. */
export const inBounds =
  (bounds: Bounds) =>
  ([x, , z]: readonly number[]): boolean =>
    x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;

/** Every point an output places: nodes, lights, markers, movers (each path point) and roads. */
export const outputPoints = (out: RegionOutput): Vec3[] => [
  ...out.instances.map((i) => i.position),
  ...out.lights.map((l) => l.position),
  ...out.markers.map((m) => m.position),
  ...out.movers.flatMap((m) => (m.kind === 'path' ? m.points : [m.position])),
  ...out.roads.flatMap((r) => r.points),
];

/**
 * What is wrong with the forest patches an output places (`regions/stands.ts`): ground below a
 * patch's plane (a floating stem) or higher above it than its bare boles (a buried crown) —
 * unless it stands on a built plinth (`onPlinth`) — a road under its square, or a solid prop
 * crossing it between its feet and its crowns (the walker's own test, `build/footprint.ts`).
 * Empty when every patch stands right.
 */
export function standProblems(plan: WorldPlan, out: RegionOutput, onPlinth = false): string[] {
  const seed = plan.subSeed('props'),
    { meshes, variants } = forestStands(seed),
    tops = meshes.map((mesh) => partBounds(mesh.parts)[1][1]),
    half = STAND_SIDE / 2,
    key = (x: number, z: number) => `${Math.floor(x / STAND_SIDE)},${Math.floor(z / STAND_SIDE)}`,
    lanes = new Map<string, [Vec3, Vec3, Road][]>(),
    { near } = solidIndex(solidColliders([...out.props, ...sharedProps(seed)], out.instances)),
    problems: string[] = [];
  // Road segments filed under every patch-grid cell a patch reaching them could stand in.
  for (const road of [...plan.roads, ...out.roads])
    road.points.slice(1).forEach((b, i) => {
      const a = road.points[i],
        reach = road.width / 2 + half * Math.SQRT2,
        [x0, x1] = [Math.min(a[0], b[0]) - reach, Math.max(a[0], b[0]) + reach],
        [z0, z1] = [Math.min(a[2], b[2]) - reach, Math.max(a[2], b[2]) + reach];
      for (let gx = Math.floor(x0 / STAND_SIDE); gx <= Math.floor(x1 / STAND_SIDE); gx++)
        for (let gz = Math.floor(z0 / STAND_SIDE); gz <= Math.floor(z1 / STAND_SIDE); gz++) {
          const cell = `${gx},${gz}`,
            list = lanes.get(cell);
          if (list) list.push([a, b, road]);
          else lanes.set(cell, [[a, b, road]]);
        }
    });
  for (const instance of out.instances) {
    const k = variants.findIndex((v) => v.id === instance.prop);
    if (k < 0) continue;
    const { gradient, tolerance } = variants[k],
      [x, y, z] = instance.position,
      [cos, sin] = [Math.cos(instance.yaw), Math.sin(instance.yaw)],
      name = instance.name ?? instance.prop;
    for (const [dx, dz] of onPlinth ? [] : standOffsets) {
      const rise = plan.height(x + dx, z + dz) + gradient * (dx * cos - dz * sin) - y;
      if (rise < -1e-6 || rise > tolerance + 1e-6) problems.push(`${name}: ground ${rise} m`);
    }
    const square: Rect = { x, z, hx: half, hz: half, yaw: instance.yaw };
    for (const [a, b, road] of lanes.get(key(x, z)) ?? [])
      if (segmentRect(a[0], a[2], b[0], b[2], square) < road.width / 2)
        problems.push(`${name}: on ${road.id}`);
    const print = { radius: half * Math.SQRT2, rect: [-half, -half, half, half] as const },
      at = { x, feet: y, z, yaw: instance.yaw },
      hit = near(x, z, print.radius).find((solid) =>
        crosses(solid, { ...print, low: 0, high: tops[k] }, at, tolerance),
      );
    if (hit) problems.push(`${name}: crosses ${hit.prop}`);
  }
  return [...new Set(problems)];
}
