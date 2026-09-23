/**
 * What a region's test asks of any prop: triangles whose indices exist, finite positions, unit
 * normals, one part per surface. An empty list means the prop is sound.
 */
import type { MeshPart, PropMesh, Vec3 } from '../plan/contract.ts';
import { partBounds } from './geometry.ts';

function partProblems(id: string, part: MeshPart): string[] {
  const problems: string[] = [],
    vertices = part.positions.length / 3,
    where = `${id}/${part.surface.name}`;
  if (part.positions.length % 3) problems.push(`${where}: positions are not triplets`);
  if (part.indices.length % 3 || !part.indices.length)
    problems.push(`${where}: no whole triangles`);
  if (part.indices.some((index) => index >= vertices))
    problems.push(`${where}: index out of range`);
  if (part.positions.some((value) => !Number.isFinite(value)))
    problems.push(`${where}: non-finite position`);
  if (part.normals) {
    if (part.normals.length !== part.positions.length)
      problems.push(`${where}: one normal per vertex expected`);
    for (let v = 0; v < part.normals.length; v += 3) {
      const length = Math.hypot(part.normals[v], part.normals[v + 1], part.normals[v + 2]);
      if (!(Math.abs(length - 1) < 1e-3)) {
        problems.push(`${where}: normal ${v / 3} is not unit length`);
        break;
      }
    }
  }
  return problems;
}

/** Every problem of `prop`, or none. */
export function propProblems(prop: PropMesh): string[] {
  const names = prop.parts.map((part) => part.surface.name),
    problems = prop.parts.flatMap((part) => partProblems(prop.id, part));
  if (new Set(names).size !== names.length) problems.push(`${prop.id}: two parts share a surface`);
  if (!prop.parts.length) problems.push(`${prop.id}: no parts`);
  return problems;
}

/** Triangles whose winding faces toward the part's centre: 0 for a sound convex shape. */
export function inwardFaces(part: MeshPart): number {
  const [min, max] = partBounds([part]),
    centre = min.map((v, k) => (v + max[k]) / 2),
    p = (i: number): Vec3 => [
      part.positions[i * 3],
      part.positions[i * 3 + 1],
      part.positions[i * 3 + 2],
    ];
  let inward = 0;
  for (let t = 0; t < part.indices.length; t += 3) {
    const [a, b, c] = [p(part.indices[t]), p(part.indices[t + 1]), p(part.indices[t + 2])],
      u = [0, 1, 2].map((k) => b[k] - a[k]),
      v = [0, 1, 2].map((k) => c[k] - a[k]),
      n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]],
      out = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3 - centre[k]);
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) inward++;
  }
  return inward;
}
