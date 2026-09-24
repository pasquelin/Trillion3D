/**
 * The plan's bridges inside the mountains, built span by span along the road they carry: a
 * concrete deck whose top is the road surface, a parapet on each edge, and a pier from the deck
 * down into the ground at the start of each span. Each span is a mesh of its own (spans differ
 * in length, slope and pier height), origin at its start; a bridge's spans share one group.
 */
import type { Bridge, MeshPart, PropMesh, Road, Vec3 } from '../../plan/contract.ts';
import { prop, quads, SURFACES } from '../../props/index.ts';
import { boxAt } from './parts.ts';
import type { Placer } from './space.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

const DECK = 1.2;
const PARAPET = 1.0;
/** A pier shorter than this is an abutment the ground already carries. */
const MIN_PIER = 1.5;

/**
 * A beam from `a` to `b` (its top centre line), `half` wide each side of it shifted `side`
 * metres across, `depth` deep: four long faces and two ends.
 */
function beam(surface: typeof S.concrete, a: Vec3, b: Vec3, half: number, depth: number, side = 0) {
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1,
    [nx, nz] = [-(b[2] - a[2]) / len, (b[0] - a[0]) / len],
    at = (p: Vec3, across: number, down: number): Vec3 => [
      p[0] + nx * (side + across),
      p[1] - down,
      p[2] + nz * (side + across),
    ];
  const [a0, a1, b0, b1] = [at(a, -half, 0), at(a, half, 0), at(b, -half, 0), at(b, half, 0)],
    [c0, c1, d0, d1] = [
      at(a, -half, depth),
      at(a, half, depth),
      at(b, -half, depth),
      at(b, half, depth),
    ];
  return quads(surface, [
    [a0, a1, b1, b0],
    [c0, d0, d1, c1],
    [a0, b0, d0, c0],
    [a1, c1, d1, b1],
    [a0, c0, c1, a1],
    [b0, b1, d1, d0],
  ]);
}

/** The points of `road` from the one nearest `from` to the one nearest `to`. */
function course(road: Road, bridge: Bridge): Vec3[] {
  const nearest = (p: Vec3) =>
    road.points.reduce(
      (best, q, i) =>
        Math.hypot(q[0] - p[0], q[2] - p[2]) <
        Math.hypot(road.points[best][0] - p[0], road.points[best][2] - p[2])
          ? i
          : best,
      0,
    );
  const [i, j] = [nearest(bridge.from), nearest(bridge.to)].sort((m, n) => m - n);
  return road.points.slice(i, j + 1);
}

/** One span's mesh, local to its start `a`: deck, parapets, and the pier under `a`. */
function span(id: string, a: Vec3, b: Vec3, width: number, ground: number): PropMesh {
  const local = (p: Vec3): Vec3 => [p[0] - a[0], p[1] - a[1], p[2] - a[2]],
    [la, lb] = [local(a), local(b)],
    raise = (p: Vec3, h: number): Vec3 => [p[0], p[1] + h, p[2]],
    parts: MeshPart[] = [
      beam(SURFACES.asphalt, la, lb, width / 2, 0.05),
      beam(S.concrete, raise(la, -0.05), raise(lb, -0.05), width / 2 + 0.6, DECK),
    ];
  for (const side of [-1, 1])
    parts.push(
      beam(
        S.concrete,
        raise(la, PARAPET),
        raise(lb, PARAPET),
        0.15,
        PARAPET,
        side * (width / 2 + 0.4),
      ),
    );
  const pier = a[1] - DECK - ground;
  if (pier > MIN_PIER)
    parts.push(
      boxAt(S.concrete, [width * 0.6, pier + 1, 2.2], {
        at: [0, -DECK - pier - 1, 0],
        yaw: Math.atan2(lb[0], lb[2]),
      }),
    );
  return prop(id, parts);
}

/** Builds and places every span of every plan bridge inside the region. */
export function placeBridges(placer: Placer): PropMesh[] {
  const meshes: PropMesh[] = [];
  for (const bridge of placer.plan.bridges) {
    const road = placer.plan.roads.find((r) => r.id === bridge.road);
    if (
      !road ||
      !placer.owns(bridge.from[0], bridge.from[2]) ||
      !placer.owns(bridge.to[0], bridge.to[2])
    )
      continue;
    const points = course(road, bridge),
      group = `mountains/bridge/${bridge.id}`;
    for (let k = 0; k + 1 < points.length; k++) {
      const [a, b] = [points[k], points[k + 1]],
        mesh = placer.register(
          span(`${group}/span-${k}`, a, b, bridge.width, placer.plan.height(a[0], a[2])),
        );
      if (placer.place(mesh.id, a[0], a[2], { y: a[1], onRoad: true, group, name: mesh.id }))
        meshes.push(mesh);
    }
  }
  return meshes;
}
