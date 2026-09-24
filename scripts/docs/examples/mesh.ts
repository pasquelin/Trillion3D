import type { Mesh } from '../shadow-theatre/geometry.ts';
import { snap, type Vec3 } from './random.ts';
import { geometry, type Geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts';
import { computeNormals } from '../../../packages/sdk-core/src/world/geometry/normals.ts';

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
  normals = Array.from(computeNormals(positions, indices)),
): Mesh {
  return { positions, normals, uvs, indices };
}

/** An sdk-core geometry as a scene mesh: its positions, normals, (u, v) and triangles. */
export function fromGeometry(built: Geometry): Mesh {
  const { position, normal, uv } = built.attributes;
  return {
    positions: Array.from(position.array),
    normals: Array.from(normal.array),
    uvs: Array.from(uv.array),
    indices: Array.from(built.index!.array),
  };
}

/**
 * The mesh with its vertices at one place made one, each keeping its first copy's normal and
 * (u, v): a surface a generator cut along a seam, or into loose triangles, shades smooth again.
 */
export function welded(mesh: Mesh): Mesh {
  const out: Mesh = { positions: [], normals: [], uvs: [], indices: [] },
    kept = new Map<string, number>();
  const remap = Array.from({ length: mesh.positions.length / 3 }, (_, v) => {
    const at = mesh.positions.slice(v * 3, v * 3 + 3),
      key = at.map((value) => Math.round(value * 1e9)).join();
    let index = kept.get(key);
    if (index === undefined) {
      kept.set(key, (index = kept.size));
      out.positions.push(...at);
      out.normals.push(...mesh.normals.slice(v * 3, v * 3 + 3));
      out.uvs.push(...mesh.uvs.slice(v * 2, v * 2 + 2));
    }
    return index;
  });
  out.indices = mesh.indices.map((index) => remap[index]);
  return out;
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

/** A flat disc of `segments` sides at height `y`, facing up or down: sdk-core's `circle`, laid flat. */
export function disc(radius: number, y: number, segments: number, up = true): Mesh {
  const flat = geometry.circle(radius, segments).rotateX(((up ? -1 : 1) * Math.PI) / 2);
  return { ...fromGeometry(flat.translate(0, y, 0)), uvs: [] };
}

/**
 * Revolves `(radius, height)` points, bottom to top, about +Y: sdk-core's `lathe`, turned from
 * +X towards -Z. With `repeat` — repeats around, metres per repeat along the profile — its (u, v)
 * are in those repeats, so a texture wraps without a jump; without, the mesh carries none.
 */
export function lathe(
  profile: readonly (readonly [number, number])[],
  segments: number,
  { caps = true, repeat }: { caps?: boolean; repeat?: readonly [number, number] } = {},
): Mesh {
  const body = fromGeometry(geometry.lathe(profile, segments, Math.PI / 2));
  if (!repeat) body.uvs = [];
  else {
    const arcs = [0];
    for (let row = 1; row < profile.length; row++)
      arcs.push(
        arcs[row - 1] + Math.hypot(...[0, 1].map((k) => profile[row][k] - profile[row - 1][k])),
      );
    body.uvs = body.uvs.map((value, i) =>
      i % 2 ? arcs[Math.floor(i / 2 / (segments + 1))] / repeat[1] : value * repeat[0],
    );
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
