import { facing, gridIndices, solid, type Mesh } from './mesh.ts';
import type { Vec3 } from './random.ts';

/** An axis box centred on the origin, flat-shaded; with `uvScale`, per-face (u, v) in metres. */
export function box(sx: number, sy: number, sz: number, uvScale?: number): Mesh {
  const size = [sx, sy, sz],
    positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [1, -1]) {
      const [u, v] = [(axis + 1) % 3, (axis + 2) % 3],
        base = positions.length / 3;
      for (const [a, b] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const point = [0, 0, 0];
        point[axis] = (sign * size[axis]) / 2;
        point[u] = (a * size[u]) / 2;
        point[v] = (b * size[v]) / 2;
        positions.push(...point);
        normals.push(...[0, 1, 2].map((k) => (k === axis ? sign : 0)));
        if (uvScale) uvs.push(((a + 1) / 2) * size[u] * uvScale, ((b + 1) / 2) * size[v] * uvScale);
      }
      const [q1, q2] = sign > 0 ? [1, 2] : [2, 1];
      indices.push(base, base + q1, base + q2, base, base + q1 + 1, base + q2 + 1);
    }
  return solid(positions, indices, uvs, normals);
}

/** A square of side `size` centred on the origin, `cells` cells a side, `y = height(x, z)`. */
export function heightfield(size: number, cells: number, height: (x: number, z: number) => number) {
  const positions: number[] = [];
  for (let i = 0; i <= cells; i++)
    for (let j = 0; j <= cells; j++) {
      const [x, z] = [(i / cells - 0.5) * size, (j / cells - 0.5) * size];
      positions.push(x, height(x, z), z);
    }
  return facing(solid(positions, gridIndices(cells, cells)), () => [0, 1, 0]);
}

/** A unit icosahedron subdivided `subdivisions` times, each vertex pushed to `radius(point)`. */
export function icosphere(subdivisions: number, radius: (point: Vec3) => number = () => 1) {
  const t = (1 + Math.sqrt(5)) / 2,
    unit = ([x, y, z]: readonly number[]): Vec3 => {
      const length = Math.hypot(x, y, z);
      return [x / length, y / length, z / length];
    };
  // Three golden rectangles, one in each pair of axes: (±1, ±t, 0) turned through the axes.
  const vertices: Vec3[] = [0, 1, 2].flatMap((shift) =>
    [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ].map(([a, b]) => {
      const point = [a, b * t, 0];
      return unit([0, 1, 2].map((k) => point[(k - shift + 3) % 3]));
    }),
  );
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1,
    8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ].flatMap((_, i, flat) => (i % 3 ? [] : [flat.slice(i, i + 3)]));
  for (let level = 0; level < subdivisions; level++) {
    const middles = new Map<number, number>(),
      middle = (a: number, b: number) => {
        const key = Math.min(a, b) * 1e6 + Math.max(a, b);
        if (!middles.has(key)) {
          vertices.push(unit(vertices[a].map((value, k) => value + vertices[b][k])));
          middles.set(key, vertices.length - 1);
        }
        return middles.get(key)!;
      };
    faces = faces.flatMap(([a, b, c]) => {
      const [ab, bc, ca] = [middle(a, b), middle(b, c), middle(c, a)];
      return [
        [a, ab, ca],
        [b, bc, ab],
        [c, ca, bc],
        [ab, bc, ca],
      ];
    });
  }
  const positions = vertices.flatMap((point) => point.map((value) => value * radius(point)));
  return facing(solid(positions, faces.flat()), (v) => [
    positions[v * 3],
    positions[v * 3 + 1],
    positions[v * 3 + 2],
  ]);
}

/**
 * A (p, q) torus knot: a tube of `radial` sides swept along `tubular` rings of the closed curve,
 * its radius scaled by `ripple(u, v)` when given; wound so its normals leave the tube.
 */
export function torusKnot(
  [p, q]: readonly [number, number],
  radius: number,
  tube: number,
  [tubular, radial]: readonly [number, number],
  ripple: (u: number, v: number) => number = () => 1,
) {
  const curve = (t: number): Vec3 => {
    const r = radius * (2 + Math.cos(q * t)) * 0.5;
    return [r * Math.cos(p * t), radius * Math.sin(q * t) * 0.5, r * Math.sin(p * t)];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = (a: Vec3) => Math.hypot(...a),
    positions: number[] = [],
    centres: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < tubular; i++) {
    const u = (2 * Math.PI * i) / tubular,
      [c0, c1] = [curve(u), curve(u + 0.01)],
      tangent: Vec3 = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]],
      binormal = cross(tangent, [c1[0] + c0[0], c1[1] + c0[1], c1[2] + c0[2]]),
      normal = cross(binormal, tangent),
      [nl, bl] = [length(normal), length(binormal)];
    for (let j = 0; j < radial; j++) {
      const v = (2 * Math.PI * j) / radial,
        rad = tube * ripple(u, v),
        [cx, cy] = [-rad * Math.cos(v), rad * Math.sin(v)];
      for (let k = 0; k < 3; k++) {
        positions.push(c0[k] + (cx * normal[k]) / nl + (cy * binormal[k]) / bl);
        centres.push(c0[k]);
      }
      const [r1, j1] = [(i + 1) % tubular, (j + 1) % radial],
        [a, b, d, e] = [i * radial + j, i * radial + j1, r1 * radial + j, r1 * radial + j1];
      indices.push(a, d, b, b, d, e);
    }
  }
  return facing(solid(positions, indices), (v) => [
    positions[v * 3] - centres[v * 3],
    positions[v * 3 + 1] - centres[v * 3 + 1],
    positions[v * 3 + 2] - centres[v * 3 + 2],
  ]);
}

/**
 * `count` points evenly spaced in parameter along the Catmull–Rom spline through `points`, then
 * the last point itself: a smooth profile from a few control points.
 */
export function spline(points: readonly (readonly [number, number])[], count: number) {
  const padded = [points[0], ...points, points[points.length - 1]],
    segments = points.length - 1,
    samples: [number, number][] = [];
  for (let s = 0; s < count; s++) {
    const t = (s * segments) / count,
      i = Math.floor(t),
      f = t - i,
      [p0, p1, p2, p3] = padded.slice(i, i + 4);
    samples.push(
      [0, 1].map(
        (k) =>
          0.5 *
          (2 * p1[k] +
            (-p0[k] + p2[k]) * f +
            (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f ** 2 +
            (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f ** 3),
      ) as [number, number],
    );
  }
  samples.push([...points[points.length - 1]]);
  return samples;
}
