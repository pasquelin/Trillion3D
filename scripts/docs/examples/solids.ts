import { facing, fromGeometry, solid, welded, type Mesh } from './mesh.ts';
import type { Vec3 } from './random.ts';
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts';
import { SplineCurve } from '../../../packages/sdk-core/src/world/math/curves.ts';
import { Vector3 } from '../../../packages/sdk-core/src/world/math/vector3.ts';

/** The three values of vertex `v` in a flat list of positions or normals. */
const corner = (values: readonly number[], v: number): Vec3 => [
  values[v * 3],
  values[v * 3 + 1],
  values[v * 3 + 2],
];

/**
 * An axis box centred on the origin, flat-shaded: sdk-core's `box`. With `uvScale`, each face's
 * (u, v) are in metres along its two sides, times `uvScale`; without, the mesh carries none.
 */
export function box(sx: number, sy: number, sz: number, uvScale?: number): Mesh {
  const mesh = fromGeometry(geometry.box(sx, sy, sz));
  if (!uvScale) return { ...mesh, uvs: [] };
  // A face across x spans depth by height, across y width by depth, across z width by height.
  const sides = [
    [sz, sy],
    [sx, sz],
    [sx, sy],
  ];
  mesh.uvs = mesh.uvs.map((value, i) => {
    const normal = corner(mesh.normals, i >> 1).map(Math.abs);
    return value * sides[normal.indexOf(1)][i % 2] * uvScale;
  });
  return mesh;
}

/** A square of side `size` centred on the origin, `cells` cells a side, `y = height(x, z)`. */
export function heightfield(size: number, cells: number, height: (x: number, z: number) => number) {
  const ground = fromGeometry(geometry.plane(size, size, cells, cells).rotateX(-Math.PI / 2));
  const positions = ground.positions.map((value, i, all) =>
    i % 3 === 1 ? height(all[i - 1], all[i + 1]) : value,
  );
  return facing(solid(positions, ground.indices), () => [0, 1, 0]);
}

/** The icosahedron: three golden rectangles, one in each pair of axes, and its twenty faces. */
const T = (1 + Math.sqrt(5)) / 2;
const ICOSAHEDRON = [
  [-1, T, 0, 1, T, 0, -1, -T, 0, 1, -T, 0],
  [0, -1, T, 0, 1, T, 0, -1, -T, 0, 1, -T],
  [T, 0, -1, T, 0, 1, -T, 0, -1, -T, 0, 1],
].flat();
const FACES = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];

/**
 * The unit icosahedron, each face cut into `4^subdivisions` triangles on the sphere (sdk-core's
 * `polyhedron`), each vertex pushed to `radius(point)`.
 */
export function icosphere(subdivisions: number, radius: (point: Vec3) => number = () => 1) {
  const sphere = welded(
    fromGeometry(geometry.polyhedron(ICOSAHEDRON, FACES, 1, 2 ** subdivisions - 1)),
  );
  const positions: number[] = [];
  for (let v = 0; v < sphere.positions.length / 3; v++) {
    const point = corner(sphere.positions, v),
      scale = radius(point);
    positions.push(...point.map((value) => value * scale));
  }
  return facing(solid(positions, sphere.indices), (v) => corner(positions, v));
}

/**
 * A (p, q) torus knot, its axis on y: sdk-core's `torusKnot`, a tube of `radial` sides swept
 * along `tubular` rings, its radius scaled by `ripple(u, v)` when given; wound so its normals
 * leave the tube.
 */
export function torusKnot(
  [p, q]: readonly [number, number],
  radius: number,
  tube: number,
  [tubular, radial]: readonly [number, number],
  ripple: (u: number, v: number) => number = () => 1,
) {
  const knot = fromGeometry(geometry.torusKnot(radius, tube, tubular, radial, p, q)),
    // The sdk-core knot turns about z: y and z trade places.
    swap = (values: number[]) => values.map((_, i) => values[i - (i % 3) + [0, 2, 1][i % 3]]),
    normals = swap(knot.normals),
    positions = swap(knot.positions).map((value, i) => {
      const at = Math.floor(i / 3) * 2,
        [u, v] = [knot.uvs[at], knot.uvs[at + 1]].map((t) => 2 * Math.PI * t);
      return value + tube * normals[i] * (ripple(u, v) - 1);
    });
  const closed = welded({ ...knot, positions, normals });
  return facing(solid(closed.positions, closed.indices), (v) => corner(closed.normals, v));
}

/**
 * `count` points evenly spaced in parameter along the Catmull–Rom spline through `points`, then
 * the last point itself: a smooth profile from a few control points.
 */
export function spline(points: readonly (readonly [number, number])[], count: number) {
  const curve = new SplineCurve(points.map(([x, y]) => new Vector3(x, y, 0)));
  const samples = Array.from({ length: count }, (_, s): [number, number] => {
    const { x, y } = curve.getPoint(s / count);
    return [x, y];
  });
  samples.push([...points[points.length - 1]]);
  return samples;
}
