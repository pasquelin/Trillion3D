/**
 * Flat-faced shapes. Every shape stands on the ground: its base at y = 0, centred on the Y axis,
 * so `transform(shape, { at })` puts its foot at `at`. Metres; front faces counter-clockwise.
 * Move, turn and group them with `props/transform.ts`.
 */
import type { MeshPart, Surface, Vec3 } from '../plan/contract.ts';
import { meshPart } from './geometry.ts';
import { signedArea, triangulate, type Point2 } from './triangulate.ts';

/** Quads `[a, b, c, d]` (counter-clockwise seen from the front), each with its own vertices. */
export function quads(surface: Surface, faces: readonly (readonly Vec3[])[]): MeshPart {
  const positions: number[] = [],
    indices: number[] = [];
  for (const face of faces) {
    const first = positions.length / 3;
    positions.push(...face.flat());
    for (let k = 1; k + 1 < face.length; k++) indices.push(first, first + k, first + k + 1);
  }
  return meshPart(surface, positions, indices);
}

/** A box of `[width (x), height (y), depth (z)]`, base at y = 0: 12 triangles. */
export function box(surface: Surface, [w, h, d]: Vec3): MeshPart {
  const x = w / 2,
    z = d / 2;
  const c = (i: number): Vec3 => [i & 1 ? x : -x, i & 2 ? h : 0, i & 4 ? z : -z];
  const face = (...corners: number[]) => corners.map(c);
  return quads(surface, [
    face(1, 3, 7, 5),
    face(0, 4, 6, 2),
    face(2, 6, 7, 3),
    face(0, 1, 5, 4),
    face(4, 5, 7, 6),
    face(0, 2, 3, 1),
  ]);
}

/** A horizontal rectangle facing up, centred on the origin: 2 triangles. */
export function plane(surface: Surface, width: number, depth: number): MeshPart {
  const x = width / 2,
    z = depth / 2;
  return quads(surface, [
    [
      [-x, 0, -z],
      [-x, 0, z],
      [x, 0, z],
      [x, 0, -z],
    ],
  ]);
}

/**
 * A pitched roof over a `width` (x) × `depth` (z) footprint, the ridge along X at `height`,
 * `overhang` past every wall. Two slopes and two gables; open underneath: 6 triangles.
 * `hip` > 0 pulls the ridge ends inward by that much (a hipped roof, 6 triangles too).
 */
export function roofPrism(
  surface: Surface,
  width: number,
  depth: number,
  height: number,
  { overhang = 0, hip = 0 }: { overhang?: number; hip?: number } = {},
): MeshPart {
  const x = width / 2 + overhang,
    z = depth / 2 + overhang,
    r = Math.max(0, x - hip);
  const a: Vec3 = [-x, 0, -z],
    b: Vec3 = [x, 0, -z],
    c: Vec3 = [x, 0, z],
    d: Vec3 = [-x, 0, z],
    left: Vec3 = [-r, height, 0],
    right: Vec3 = [r, height, 0];
  return quads(surface, [
    [d, c, right, left],
    [b, a, left, right],
    [a, d, left],
    [c, b, right],
  ]);
}

/**
 * A prism: a simple 2D outline on the ground (`[x, z]` pairs, either winding, no holes) raised
 * to `height`. Walls are flat quads facing out, top and bottom caps ear-clipped.
 * `caps: 'top'` leaves the underside open (a building on the ground).
 */
export function extrude(
  surface: Surface,
  shape: readonly Point2[],
  height: number,
  { caps = 'both' }: { caps?: 'both' | 'top' | 'none' } = {},
): MeshPart {
  // Walls face out when the outline turns from +X toward +Z; reverse any other.
  const outline = signedArea(shape) > 0 ? shape : [...shape].reverse();
  const walls = outline.map((p, i): Vec3[] => {
    const q = outline[(i + 1) % outline.length];
    return [
      [q[0], 0, q[1]],
      [p[0], 0, p[1]],
      [p[0], height, p[1]],
      [q[0], height, q[1]],
    ];
  });
  const part = quads(surface, walls);
  if (caps === 'none') return part;
  const positions = [...part.positions],
    indices = [...part.indices],
    cap = triangulate(outline);
  const addCap = (y: number, up: boolean) => {
    const first = positions.length / 3;
    for (const [x, z] of outline) positions.push(x, y, z);
    // A positive (x, z) turn faces down (x × z = -y): flip it for the top.
    for (let t = 0; t < cap.length; t += 3)
      indices.push(first + cap[t], first + cap[t + (up ? 2 : 1)], first + cap[t + (up ? 1 : 2)]);
  };
  addCap(height, true);
  if (caps === 'both') addCap(0, false);
  return meshPart(surface, positions, indices);
}

/**
 * A parametric sheet: `sample(u, v)` for u, v in [0, 1] on a `columns` × `rows` grid, smooth
 * and open. The front faces the side `∂u × ∂v` points to. Sails, awnings, canopies.
 */
export function sheet(
  surface: Surface,
  columns: number,
  rows: number,
  sample: (u: number, v: number) => Vec3,
): MeshPart {
  const positions: number[] = [],
    indices: number[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= columns; i++) positions.push(...sample(i / columns, j / rows));
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const a = j * (columns + 1) + i,
        b = a + columns + 1;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  return meshPart(surface, positions, indices);
}
