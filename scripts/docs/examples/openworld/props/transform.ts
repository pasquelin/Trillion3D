/**
 * Placing parts inside a prop: a translate-rotate-scale or a 4 × 4 matrix moves a part (normals
 * by the inverse transpose, winding flipped by a mirror), `merge` gathers parts into one part per
 * surface, `prop` names the result.
 */
import type { MeshPart, PropMesh, Vec3 } from '../plan/contract.ts';
import { smoothNormals } from './geometry.ts';
import { assertSameSurface } from './surfaces.ts';

/** Column-major 4 × 4 matrix, glTF order. */
export type Mat4 = readonly number[];

/**
 * Translate, rotate, scale — applied scale first, then roll (about Z), pitch (about X), yaw
 * (about Y), then the translation `at`. Angles in radians, right-handed.
 */
export type Trs = {
  at?: Vec3;
  yaw?: number;
  pitch?: number;
  roll?: number;
  scale?: number | Vec3;
};

/** The matrix of a `Trs`. */
export function trsMatrix({ at = [0, 0, 0], yaw = 0, pitch = 0, roll = 0, scale = 1 }: Trs): Mat4 {
  const [sx, sy, sz] = typeof scale === 'number' ? [scale, scale, scale] : scale,
    [cy, sy_] = [Math.cos(yaw), Math.sin(yaw)],
    [cp, sp] = [Math.cos(pitch), Math.sin(pitch)],
    [cr, sr] = [Math.cos(roll), Math.sin(roll)];
  // R = Ry · Rx · Rz, columns are the rotated unit axes.
  const x = [cy * cr + sy_ * sp * sr, cp * sr, -sy_ * cr + cy * sp * sr],
    y = [-cy * sr + sy_ * sp * cr, cp * cr, sy_ * sr + cy * sp * cr],
    z = [sy_ * cp, -sp, cy * cp];
  return [
    ...x.map((v) => v * sx),
    0,
    ...y.map((v) => v * sy),
    0,
    ...z.map((v) => v * sz),
    0,
    ...at,
    1,
  ];
}

/** `a · b`, both column-major. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  return Array.from({ length: 16 }, (_, i) => {
    const column = Math.floor(i / 4),
      row = i % 4;
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
    return sum;
  });
}

/** A point through `m`. */
export const applyPoint = (m: Mat4, [x, y, z]: Vec3): Vec3 => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/** The part moved by `by`; a mirroring transform keeps the front faces outward. */
export function transform(part: MeshPart, by: Mat4 | Trs): MeshPart {
  const m = Array.isArray(by) ? (by as Mat4) : trsMatrix(by as Trs),
    positions = new Float32Array(part.positions.length);
  for (let v = 0; v < positions.length; v += 3)
    positions.set(
      applyPoint(m, [part.positions[v], part.positions[v + 1], part.positions[v + 2]]),
      v,
    );
  const determinant =
      m[0] * (m[5] * m[10] - m[9] * m[6]) -
      m[4] * (m[1] * m[10] - m[9] * m[2]) +
      m[8] * (m[1] * m[6] - m[5] * m[2]),
    indices = Uint32Array.from(part.indices);
  if (determinant < 0)
    for (let i = 0; i < indices.length; i += 3)
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  // Normals re-derived over the same sharing: the inverse transpose, without writing it.
  return { surface: part.surface, positions, indices, normals: smoothNormals(positions, indices) };
}

/** Parts gathered into one part per surface name, in first-seen order. */
export function merge(parts: readonly MeshPart[]): MeshPart[] {
  const groups = new Map<string, MeshPart[]>();
  for (const part of parts) {
    const group = groups.get(part.surface.name);
    if (!group) {
      groups.set(part.surface.name, [part]);
      continue;
    }
    assertSameSurface(group[0].surface, part.surface);
    group.push(part);
  }
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const vertices = group.reduce((sum, p) => sum + p.positions.length, 0),
      triangles = group.reduce((sum, p) => sum + p.indices.length, 0),
      positions = new Float32Array(vertices),
      normals = new Float32Array(vertices),
      indices = new Uint32Array(triangles);
    let v = 0,
      i = 0;
    for (const p of group) {
      positions.set(p.positions, v);
      normals.set(p.normals ?? smoothNormals(p.positions, p.indices), v);
      for (let k = 0; k < p.indices.length; k++) indices[i + k] = p.indices[k] + v / 3;
      v += p.positions.length;
      i += p.indices.length;
    }
    return { surface: group[0].surface, positions, normals, indices };
  });
}

/** A shared prop: its parts merged by surface, under a stable id. */
export const prop = (id: string, parts: readonly MeshPart[]): PropMesh => ({
  id,
  parts: merge(parts),
});
