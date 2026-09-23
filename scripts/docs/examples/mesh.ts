import type { Mesh } from '../shadow-theatre/geometry.ts';
import { snap, type Vec3 } from './random.ts';

/**
 * The mesh toolkit of the scenes modelled in code: flat position, normal, (u, v) and index
 * arrays, the workshop's `Mesh`; an empty `uvs` means the mesh carries no texture coordinates.
 */
export type { Mesh };

/** The pairs of flat lists joined, `[a, b], [c, d]` to `[[a, b], [c, d]]`: compact profiles. */
export function pairs(...lists: readonly (readonly number[])[]) {
  const flat = lists.flat();
  return Array.from({ length: flat.length / 2 }, (_, i): [number, number] => [
    flat[i * 2],
    flat[i * 2 + 1],
  ]);
}

/** Area-weighted vertex normals: each triangle adds its unnormalised face normal to its corners. */
function vertexNormals(positions: readonly number[], indices: readonly number[]) {
  const normals: number[] = Array(positions.length).fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3],
      e = [0, 1, 2].map((k) => positions[b + k] - positions[a + k]),
      f = [0, 1, 2].map((k) => positions[c + k] - positions[a + k]),
      face = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
    for (const corner of [a, b, c]) for (let k = 0; k < 3; k++) normals[corner + k] += face[k];
  }
  return normalized(normals);
}

function normalized(vectors: number[]) {
  for (let v = 0; v < vectors.length; v += 3) {
    const length = Math.hypot(vectors[v], vectors[v + 1], vectors[v + 2]) + 1e-12;
    for (let k = 0; k < 3; k++) vectors[v + k] /= length;
  }
  return vectors;
}

/** The mesh on the `snap` grid; its normals, once snapped, are brought back to unit length. */
export function snapped(mesh: Mesh): Mesh {
  const normals = mesh.normals.map(snap);
  for (let v = 0; v < normals.length; v += 3) {
    const [x, y, z] = normals.slice(v, v + 3),
      length = Math.sqrt(x * x + y * y + z * z) || 1;
    for (let k = 0; k < 3; k++) normals[v + k] /= length;
  }
  return { ...mesh, positions: mesh.positions.map(snap), normals, uvs: mesh.uvs.map(snap) };
}

/** A mesh from its positions and triangles; its normals are computed unless given. */
export function solid(
  positions: number[],
  indices: number[],
  uvs: number[] = [],
  normals = vertexNormals(positions, indices),
): Mesh {
  return { positions, normals, uvs, indices };
}

/** The mesh scaled per axis, then moved by `offset`; its normals follow the scaling. */
export function moved(mesh: Mesh, offset: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): Mesh {
  return {
    ...mesh,
    positions: mesh.positions.map((value, index) => value * scale[index % 3] + offset[index % 3]),
    normals: normalized(mesh.normals.map((value, index) => value / scale[index % 3])),
  };
}

/** One mesh of several; texture coordinates survive only when every part has them. */
export function merge(meshes: readonly Mesh[]): Mesh {
  const withUv = meshes.every(({ uvs }) => uvs.length),
    merged: Mesh = { positions: [], normals: [], uvs: [], indices: [] };
  for (const mesh of meshes) {
    const base = merged.positions.length / 3;
    // One value at a time: spreading a large array into `push` overflows the call stack.
    for (const value of mesh.positions) merged.positions.push(value);
    for (const value of mesh.normals) merged.normals.push(value);
    if (withUv) for (const value of mesh.uvs) merged.uvs.push(value);
    for (const index of mesh.indices) merged.indices.push(index + base);
  }
  return merged;
}

/** Two triangles per cell of a grid of `rows + 1` rows of `cols` (+ 1 unless `wrap`) vertices. */
export function gridIndices(rows: number, cols: number, wrap = false) {
  const stride = wrap ? cols : cols + 1,
    indices: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const next = wrap ? (c + 1) % cols : c + 1,
        [a, b, d, e] = [
          r * stride + c,
          r * stride + next,
          (r + 1) * stride + c,
          (r + 1) * stride + next,
        ];
      indices.push(a, d, b, b, d, e);
    }
  return indices;
}

/** The mesh wound so its normals mostly agree with `outward(vertex)`; normals recomputed. */
export function facing(mesh: Mesh, outward: (vertex: number) => Vec3): Mesh {
  let agreement = 0;
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const [x, y, z] = outward(v);
    agreement +=
      x * mesh.normals[v * 3] + y * mesh.normals[v * 3 + 1] + z * mesh.normals[v * 3 + 2];
  }
  if (agreement >= 0) return mesh;
  const flipped = mesh.indices.map((_, i) => mesh.indices[i - (i % 3) + [0, 2, 1][i % 3]]);
  return solid(mesh.positions, flipped, mesh.uvs);
}

/** A flat disc of `segments` sides at height `y`, facing up or down. */
export function disc(radius: number, y: number, segments: number, up = true): Mesh {
  const positions = [0, y, 0],
    indices: number[] = [];
  for (let k = 0; k < segments; k++) {
    const angle = (2 * Math.PI * k) / segments;
    positions.push(radius * Math.cos(angle), y, -radius * Math.sin(angle));
    const next = 1 + ((k + 1) % segments);
    indices.push(0, ...(up ? [1 + k, next] : [next, 1 + k]));
  }
  const normals = positions.map((_, index) => (index % 3 === 1 ? (up ? 1 : -1) : 0));
  return solid(positions, indices, [], normals);
}

/**
 * Revolves `(radius, height)` points, bottom to top, about +Y. With `repeat` — repeats around,
 * metres per repeat along the profile — the seam column is doubled so a texture wraps without a
 * jump, and both copies of a seam vertex share one normal.
 */
export function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
  { caps = true, repeat }: { caps?: boolean; repeat?: readonly [number, number] } = {},
): Mesh {
  const columns = repeat ? segments + 1 : segments,
    positions: number[] = [],
    uvs: number[] = [];
  let arc = 0;
  profile.forEach(([radius, y], row) => {
    if (row) arc += Math.hypot(radius - profile[row - 1][0], y - profile[row - 1][1]);
    for (let k = 0; k < columns; k++) {
      const angle = (2 * Math.PI * k) / segments;
      positions.push(radius * Math.cos(angle), y, -radius * Math.sin(angle));
      if (repeat) uvs.push((k / segments) * repeat[0], arc / repeat[1]);
    }
  });
  const indices = gridIndices(profile.length - 1, segments, !repeat),
    body = facing(solid(positions, indices, uvs), (v) => [
      positions[v * 3],
      0,
      positions[v * 3 + 2],
    ]);
  if (repeat)
    for (let row = 0; row < profile.length; row++) {
      const [first, last] = [row * columns * 3, (row * columns + segments) * 3],
        seam = normalized([0, 1, 2].map((k) => body.normals[first + k] + body.normals[last + k]));
      for (let k = 0; k < 3; k++) body.normals[first + k] = body.normals[last + k] = seam[k];
    }
  const parts = [body];
  for (const [row, up] of [
    [0, false],
    [profile.length - 1, true],
  ] as const) {
    const [radius, y] = profile[row];
    if (!caps || radius <= 1e-6) continue;
    const cap = disc(radius, y, segments, up);
    if (repeat) cap.uvs = cap.positions.filter((_, i) => i % 3 !== 1).map((v) => v / repeat[1]);
    parts.push(cap);
  }
  return merge(parts);
}
