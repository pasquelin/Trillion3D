/**
 * Lattice steelwork: a square box truss between two points — four chords, and in every bay an
 * X brace on each face and a ring of struts — tapering from one width to another. Pylons, crane
 * booms, masts. Tubes throughout, so it reads as steel from any side.
 */
import type { MeshPart, Surface, Vec3 } from '../plan/contract.ts';
import { tube } from './round.ts';
import { merge } from './transform.ts';
import { add, cross, sub, unit } from './vector.ts';

export type TrussOptions = {
  /** Full width at `from` and at `to` (m). */
  width: readonly [number, number];
  bays: number;
  /** Chord and brace radii (m), and tube sides. */
  chord: number;
  brace: number;
  sides?: number;
};

/** A straight bar between two points. */
const bar = (surface: Surface, a: Vec3, b: Vec3, radius: number, sides = 6) =>
  tube(surface, [a, b], radius, { segments: sides });

/** A box truss from `from` to `to`. */
export function truss(surface: Surface, from: Vec3, to: Vec3, options: TrussOptions): MeshPart {
  const { width, bays, chord, brace, sides = 6 } = options,
    axis = sub(to, from),
    along = unit(axis),
    u = unit(cross(along, Math.abs(along[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0])),
    v = cross(u, along),
    signs: readonly [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
  const corner = (bay: number, i: number): Vec3 => {
    const t = bay / bays,
      half = (width[0] + (width[1] - width[0]) * t) / 2;
    return add(add(add(from, axis, t), u, signs[i][0] * half), v, signs[i][1] * half);
  };
  const parts = signs.map((_, i) =>
    tube(
      surface,
      Array.from({ length: bays + 1 }, (_, b) => corner(b, i)),
      chord,
      { segments: sides },
    ),
  );
  for (let b = 0; b < bays; b++)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      parts.push(
        bar(surface, corner(b, i), corner(b + 1, j), brace, sides),
        bar(surface, corner(b, j), corner(b + 1, i), brace, sides),
        bar(surface, corner(b + 1, i), corner(b + 1, j), brace, sides),
      );
    }
  return merge(parts)[0];
}
