/**
 * Real roofs: every slope is a sheet of tile courses — each course standing proud at its lower
 * edge and sliding under the next — with the rolls of clay tiles across it, a flat soffit under
 * the eaves, a ridge cap, fascia boards and gable walls. Clay, slate and thatch differ only by
 * their course, their roll and their thickness.
 */
import type { MeshPart, Surface, Vec3 } from '../../plan/contract.ts';
import { box, quads, sheet, SURFACES, transform } from '../../props/index.ts';
import { LAND } from './ground.ts';

/** How a roof covering reads: course height up the slope, roll width across, their relief. */
export type Covering = {
  surface: Surface;
  course: number;
  step: number;
  roll: number;
  bulge: number;
};

export const COVERINGS = {
  clay: { surface: SURFACES.roofTile, course: 0.34, step: 0.03, roll: 0.26, bulge: 0.045 },
  slate: { surface: SURFACES.slate, course: 0.24, step: 0.015, roll: 0, bulge: 0 },
  thatch: { surface: LAND.thatch, course: 0.55, step: 0.09, roll: 0, bulge: 0 },
} as const satisfies Record<string, Covering>;

const OVERHANG = 0.45;

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const unit = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};

/**
 * One slope between its eave (`a` → `b`, counter-clockwise seen from outside) and its top
 * (`c` → `d`, which may meet in a point for a hip), tiled course by course, with its soffit.
 */
export function slope(look: Covering, a: Vec3, b: Vec3, c: Vec3, d: Vec3): MeshPart[] {
  const eave = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]),
    rise = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]),
    courses = Math.max(1, Math.round(rise / look.course)),
    rolls = look.roll ? Math.round(eave / look.roll) : 0,
    u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const,
    v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]] as const,
    normal = unit([
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ]);
  // Three rows a course: the proud lower edge, halfway, and just under the next course.
  const tiles = sheet(look.surface, Math.max(1, rolls * 4), courses * 3, (s, t) => {
    const row = Math.round(t * courses * 3) % 3,
      lift =
        look.step * (row === 0 ? 1 : row === 1 ? 0.55 : 0.1) +
        look.bulge * Math.abs(Math.sin(Math.PI * s * rolls)),
      p = lerp(lerp(a, b, s), lerp(d, c, s), t);
    return [p[0] + normal[0] * lift, p[1] + normal[1] * lift, p[2] + normal[2] * lift];
  });
  return [tiles, quads(look.surface, [c === d ? [a, d, b] : [a, d, c, b]])];
}

/**
 * A roof over a `width` × `depth` body whose walls stop at `wall`: ridge along X, `rise` above
 * the eaves, hipped by `hip` metres at each end; gables in `gable` where it is not hipped.
 */
export function roof(
  width: number,
  depth: number,
  wall: number,
  rise: number,
  look: Covering,
  gable: Surface,
  hip = 0,
): MeshPart[] {
  const x = width / 2 + OVERHANG,
    z = depth / 2 + OVERHANG,
    r = Math.max(0, x - hip),
    top = wall + rise,
    front = slope(look, [-x, wall, z], [x, wall, z], [r, top, 0], [-r, top, 0]),
    parts = [...front, ...front.map((p) => transform(p, { yaw: Math.PI }))];
  if (hip > 0)
    for (const side of [1, -1]) {
      const apex: Vec3 = [side * r, top, 0];
      parts.push(
        ...slope(look, [side * x, wall, side * z], [side * x, wall, -side * z], apex, apex),
      );
    }
  else
    for (const side of [1, -1]) {
      const w = (side * width) / 2;
      parts.push(
        quads(gable, [
          side > 0
            ? [
                [w, wall, depth / 2],
                [w, wall, -depth / 2],
                [w, top, 0],
              ]
            : [
                [w, wall, -depth / 2],
                [w, wall, depth / 2],
                [w, top, 0],
              ],
        ]),
      );
    }
  return [
    ...parts,
    transform(box(look.surface, [Math.max(0.3, 2 * r + 0.1), 0.18, 0.32]), {
      at: [0, top - 0.02, 0],
    }),
    ...[-1, 1].map((side) =>
      transform(box(SURFACES.wood, [2 * x, 0.22, 0.05]), { at: [0, wall - 0.2, side * z] }),
    ),
  ];
}
