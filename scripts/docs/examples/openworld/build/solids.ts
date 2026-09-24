/**
 * The world's solid triangles as the physics has them (#332): every placement of a prop's
 * collision mesh (`colliders.ts`), searchable by where it stands. Placements are filed by their
 * ground rectangle; a placement's own triangles are turned into the world, and filed, the first
 * time a search reaches it, so a check over a few markers only pays for what they stand near.
 */
import {
  placePoint,
  type ColliderInstance,
} from '../../../../../site/examples/kit/openworld/play/collision.ts';
import type { SolidColliders } from './colliders.ts';
import { bounds } from './collision.ts';

/** A world triangle, xyz of its three corners, and the prop it belongs to. */
export type Solid = { prop: string; corners: readonly number[] };

/** Filing cells, metres: they change how fast a search runs, never what it finds. */
const PLACEMENT_CELL = 64;
const TRIANGLE_CELL = 4;

type Rect = readonly [number, number, number, number];
type Vec = [number, number, number];

/** A grid of items filed by ground rectangle; `find` lists each item reaching a rectangle once. */
function grid<T>(cell: number) {
  const cells = new Map<string, T[]>();
  const each = ([x0, z0, x1, z1]: Rect, visit: (key: string) => void) => {
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) visit(`${i}_${j}`);
  };
  return {
    add: (item: T, rect: Rect) =>
      each(rect, (key) => {
        const list = cells.get(key);
        if (list) list.push(item);
        else cells.set(key, [item]);
      }),
    find: (rect: Rect) => {
      const found = new Set<T>();
      each(rect, (key) => cells.get(key)?.forEach((item) => found.add(item)));
      return [...found];
    },
  };
}

const groundRect = (points: readonly (readonly number[])[]): Rect => [
  Math.min(...points.map((p) => p[0])),
  Math.min(...points.map((p) => p[2])),
  Math.max(...points.map((p) => p[0])),
  Math.max(...points.map((p) => p[2])),
];

export function solidIndex({ shapes, placed }: SolidColliders) {
  const boxes = new Map(
    [...shapes].map(([id, { positions, indices }]) => [id, bounds(positions, indices)] as const),
  );
  const placements = grid<ColliderInstance>(PLACEMENT_CELL);
  for (const instance of placed) {
    const [low, high] = boxes.get(instance.prop)!,
      corners = [0, 1, 2, 3, 4, 5, 6, 7].map((c) =>
        placePoint(instance, ...([0, 1, 2].map((a) => ((c >> a) & 1 ? high : low)[a]) as Vec)),
      );
    placements.add(instance, groundRect(corners));
  }
  const turned = new Map<ColliderInstance, ReturnType<typeof grid<Solid>>>();
  const trianglesOf = (instance: ColliderInstance) => {
    let filed = turned.get(instance);
    if (filed) return filed;
    filed = grid<Solid>(TRIANGLE_CELL);
    const { positions: p, indices } = shapes.get(instance.prop)!;
    for (let t = 0; t < indices.length; t += 3) {
      const points = [0, 1, 2].map((k) => {
        const v = indices[t + k] * 3;
        return placePoint(instance, p[v], p[v + 1], p[v + 2]);
      });
      filed.add({ prop: instance.prop, corners: points.flat() }, groundRect(points));
    }
    turned.set(instance, filed);
    return filed;
  };
  /** Every solid triangle whose ground rectangle comes within `radius` of (x, z). */
  const near = (x: number, z: number, radius: number) => {
    const rect: Rect = [x - radius, z - radius, x + radius, z + radius];
    return placements.find(rect).flatMap((instance) => trianglesOf(instance).find(rect));
  };
  /** The solid surfaces right over (x, z), lowest first, and whether each faces up. */
  const over = (x: number, z: number) =>
    near(x, z, 0)
      .flatMap((solid) => {
        const y = heightOver(solid, x, z);
        return y === undefined ? [] : [{ y, up: facesUp(solid) }];
      })
      .sort((a, b) => a.y - b.y);
  return { near, over };
}

/** The height of `solid` right over (x, z), or undefined when (x, z) is not under it. */
function heightOver(solid: Solid, x: number, z: number) {
  const c = solid.corners,
    [ax, az, bx, bz, cx, cz] = [c[0] - x, c[2] - z, c[3] - x, c[5] - z, c[6] - x, c[8] - z],
    [wa, wb, wc] = [bx * cz - bz * cx, cx * az - cz * ax, ax * bz - az * bx],
    sum = wa + wb + wc;
  if (Math.abs(sum) < 1e-9 || [wa, wb, wc].some((w) => w * sum < 0)) return undefined;
  return (wa * c[1] + wb * c[4] + wc * c[7]) / sum;
}

/** Whether the triangle's front (counter-clockwise) faces up. */
const facesUp = ({ corners: c }: Solid) =>
  (c[5] - c[2]) * (c[6] - c[0]) - (c[3] - c[0]) * (c[8] - c[2]) > 0;
