/**
 * The raw layer under every shape: a list of positions and triangles becomes a contract
 * `MeshPart` with its normals. Sharing is the shading rule — a vertex shared by several
 * triangles gets their area-weighted mean normal (smooth), a triangle with vertices of its own
 * gets its face normal (flat). `flatShade` unshares, `deform` moves vertices and re-derives.
 */
import type { MeshPart, PropMesh, Surface, Vec3 } from '../plan/contract.ts';

export type Shading = 'smooth' | 'flat';

/** The unit face normal of triangle (a, b, c) of `positions`, counter-clockwise front. */
function faceNormal(positions: ArrayLike<number>, a: number, b: number, c: number): Vec3 {
  const ux = positions[b * 3] - positions[a * 3],
    uy = positions[b * 3 + 1] - positions[a * 3 + 1],
    uz = positions[b * 3 + 2] - positions[a * 3 + 2],
    vx = positions[c * 3] - positions[a * 3],
    vy = positions[c * 3 + 1] - positions[a * 3 + 1],
    vz = positions[c * 3 + 2] - positions[a * 3 + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** Area-weighted vertex normals over shared vertices; an isolated vertex points up. */
export function smoothNormals(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const corners = [indices[i], indices[i + 1], indices[i + 2]],
      n = faceNormal(positions, corners[0], corners[1], corners[2]);
    for (const v of corners) for (let k = 0; k < 3; k++) normals[v * 3 + k] += n[k];
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
    if (length > 0) for (let k = 0; k < 3; k++) normals[v + k] /= length;
    else normals.set([0, 1, 0], v);
  }
  return normals;
}

/** Every triangle gets three vertices of its own, so its normal is its face normal. */
function unshare(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++)
    for (let k = 0; k < 3; k++) out[i * 3 + k] = positions[indices[i] * 3 + k];
  return { positions: out, indices: Uint32Array.from({ length: indices.length }, (_, i) => i) };
}

/** A contract part from raw positions and triangles, normals derived by `shading`. */
export function meshPart(
  surface: Surface,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  shading: Shading = 'smooth',
): MeshPart {
  const shared =
    shading === 'flat'
      ? unshare(positions, indices)
      : { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
  return { surface, ...shared, normals: smoothNormals(shared.positions, shared.indices) };
}

/** The same part with hard edges everywhere (a low-poly rock, a faceted hull). */
export const flatShade = (part: MeshPart): MeshPart =>
  meshPart(part.surface, part.positions, part.indices, 'flat');

/**
 * Moves every vertex through `move` (world-free: it sees the part's own coordinates) and
 * re-derives smooth normals over the sharing the part already has. Deform a smooth shape, then
 * `flatShade` it, for a faceted look.
 */
export function deform(part: MeshPart, move: (p: Vec3) => Vec3): MeshPart {
  const positions = new Float32Array(part.positions.length);
  for (let v = 0; v < positions.length; v += 3)
    positions.set(move([part.positions[v], part.positions[v + 1], part.positions[v + 2]]), v);
  return meshPart(part.surface, positions, part.indices);
}

/**
 * Vertices at the same place (to 10 µm) merged into one, so a closed shape built from separate
 * sheets (a rounded box's faces, a lathe's seam ring) shades smoothly across its seams.
 * Triangles that collapse are dropped.
 */
export function weld(part: MeshPart): MeshPart {
  const index = new Map<string, number>(),
    remap = new Uint32Array(part.positions.length / 3),
    positions: number[] = [];
  for (let v = 0; v < remap.length; v++) {
    const at = [0, 1, 2].map((k) => part.positions[v * 3 + k]),
      key = at.map((value) => Math.round(value * 1e5)).join(',');
    let target = index.get(key);
    if (target === undefined) index.set(key, (target = positions.push(...at) / 3 - 1));
    remap[v] = target;
  }
  const indices: number[] = [];
  for (let t = 0; t < part.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => remap[part.indices[t + k]]);
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  return meshPart(part.surface, positions, indices);
}

/** Triangles of a part, a list of parts or a prop. */
export function triangleCount(of: MeshPart | PropMesh | readonly MeshPart[]): number {
  const parts = 'parts' in of ? of.parts : Array.isArray(of) ? of : [of as MeshPart];
  return parts.reduce((sum, part) => sum + part.indices.length / 3, 0);
}

/** The parts' axis-aligned bounds, `[min, max]`. */
export function partBounds(parts: readonly MeshPart[]): [Vec3, Vec3] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity],
    max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of parts)
    for (let v = 0; v < positions.length; v++) {
      min[v % 3] = Math.min(min[v % 3], positions[v]);
      max[v % 3] = Math.max(max[v % 3], positions[v]);
    }
  return [min, max];
}
