/** The closed parts of the scenes built of thin solids (the chalet, #415): boxes and octagonal
 *  logs, each a closed solid whose faces point away from its centre, with the normals an exporter
 *  writes. The compiler's arcade test builds the same parts in Rust (`closed_parts.rs`): keep the
 *  two in step. */
import type { Mesh } from './mesh.ts';
import type { Vec3 } from './random.ts';

/** A log's radius and the segments along it. */
export const LOG_RADIUS = 0.12;
const LOG_SEGMENTS = 8;

/** One corner, its position and its normal; three make a triangle. */
export type Corner = readonly [Vec3, Vec3];
export type Triangle = readonly [Corner, Corner, Corner];

/** The point whose coordinate on axis `a` is `coordinate(a)`. */
export const point = (coordinate: (a: number) => number): Vec3 =>
  [0, 1, 2].map(coordinate) as never;
const minus = (a: Vec3, b: Vec3) => point((k) => a[k] - b[k]);
/** The point or direction with `values` on axes `axes`, zero elsewhere. */
const on = (axes: readonly number[], values: readonly number[]) =>
  point((a) => values[axes.indexOf(a)] ?? 0);

/**
 * Pushes triangles given in pairs, each pair a quad, turned to face away from their convex part's
 * `centre`. Corners of one quad equal in position and normal are one vertex; each quad writes its
 * own, as the open world's exporter writes them: twins in everything a page stores.
 */
export function pushPart(mesh: Mesh, triangles: readonly Triangle[], centre: Vec3) {
  const shared = new Map<string, number>();
  triangles.forEach((triangle, rank) => {
    const [a, b, c] = triangle.map(([p]) => p),
      [u, v, out] = [minus(b, a), minus(c, a), minus(a, centre)];
    const facing =
      (u[1] * v[2] - u[2] * v[1]) * out[0] +
      (u[2] * v[0] - u[0] * v[2]) * out[1] +
      (u[0] * v[1] - u[1] * v[0]) * out[2];
    for (const k of facing < 0 ? [0, 2, 1] : [0, 1, 2]) {
      const [position, normal] = triangle[k],
        key = `${rank >> 1} ${position} ${normal}`;
      let index = shared.get(key);
      if (index === undefined) {
        shared.set(key, (index = mesh.positions.length / 3));
        mesh.positions.push(...position);
        mesh.normals.push(...normal);
      }
      mesh.indices.push(index);
    }
  });
}

/** The twelve triangles of a closed box, flat faces, unordered. */
export function boxTriangles(min: Vec3, max: Vec3): Triangle[] {
  const triangles: Triangle[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const plane = [axis, (axis + 1) % 3, (axis + 2) % 3];
    for (const [side, sign] of [
      [min[axis], -1],
      [max[axis], 1],
    ]) {
      const corner = (u: number, v: number): Corner => [
        on(plane, [side, u, v]),
        on([axis], [sign]),
      ];
      const [a, b, c, d] = [
        corner(min[plane[1]], min[plane[2]]),
        corner(max[plane[1]], min[plane[2]]),
        corner(max[plane[1]], max[plane[2]]),
        corner(min[plane[1]], max[plane[2]]),
      ];
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  return triangles;
}

/** A closed box. */
export function pushBox(mesh: Mesh, min: Vec3, max: Vec3) {
  pushPart(
    mesh,
    boxTriangles(min, max),
    point((a) => (min[a] + max[a]) / 2),
  );
}

/** A closed octagonal log, 0.12 m in radius, along `axis` from `start` over `length`, smooth sides and flat caps. */
export function pushLog(mesh: Mesh, axis: number, start: Vec3, length: number) {
  const s = Math.SQRT1_2,
    ring = [
      [1, 0],
      [s, s],
      [0, 1],
      [-s, s],
      [-1, 0],
      [-s, -s],
      [0, -1],
      [s, -s],
    ] as const,
    plane = [(axis + 1) % 3, (axis + 2) % 3];
  const at = (along: number, round: readonly number[]) =>
    point((a) => start[a] + (a === axis ? along : round[plane.indexOf(a)] * LOG_RADIUS));
  const side = (along: number, r: readonly number[]): Corner => [at(along, r), on(plane, r)];
  const triangles: Triangle[] = [],
    step = length / LOG_SEGMENTS;
  for (let segment = 0; segment < LOG_SEGMENTS; segment++)
    ring.forEach((r0, k) => {
      const r1 = ring[(k + 1) % ring.length],
        [a0, a1] = [segment * step, (segment + 1) * step];
      const q = [side(a0, r0), side(a1, r0), side(a1, r1), side(a0, r1)];
      triangles.push([q[0], q[1], q[2]], [q[0], q[2], q[3]]);
    });
  for (const [along, sign] of [
    [0, -1],
    [length, 1],
  ]) {
    const cap = (r: readonly number[]): Corner => [at(along, r), on([axis], [sign])];
    for (let k = 1; k < ring.length - 1; k++)
      triangles.push([cap(ring[0]), cap(ring[k]), cap(ring[k + 1])]);
  }
  pushPart(
    mesh,
    triangles,
    point((a) => start[a] + (a === axis ? length / 2 : 0)),
  );
}
