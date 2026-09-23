/**
 * Facades on any outline. A wall is walked edge by edge: each edge knows its outward normal and
 * its left and right ends as a passer-by facing it sees them. `curtainWall` dresses an edge in
 * glass, mullions, spandrels and lit office cells; `punchedWall` in framed windows, lit rooms and
 * balconies. Both return raw parts; the caller merges them into a prop.
 */
import type { MeshPart, Surface, Vec3 } from '../../plan/contract.ts';
import { box, hash01, quads, transform, type Point2 } from '../../props/index.ts';
import { CITY } from './surfaces.ts';

/** One wall edge: its left end, unit right and outward directions, and length. */
export type Edge = { left: Point2; right: Point2; out: Point2; length: number; yaw: number };

/** The edges of a closed outline (either winding), each facing away from the centroid. */
export function edgesOf(outline: readonly Point2[]): Edge[] {
  const cx = outline.reduce((s, p) => s + p[0], 0) / outline.length,
    cz = outline.reduce((s, p) => s + p[1], 0) / outline.length;
  return outline.map((p, i) => {
    const q = outline[(i + 1) % outline.length],
      length = Math.hypot(q[0] - p[0], q[1] - p[1]),
      d: Point2 = [(q[0] - p[0]) / length, (q[1] - p[1]) / length];
    let out: Point2 = [d[1], -d[0]];
    const mx = (p[0] + q[0]) / 2 - cx,
      mz = (p[1] + q[1]) / 2 - cz;
    if (out[0] * mx + out[1] * mz < 0) out = [-out[0], -out[1]];
    // Seen from outside, "right" is (out.z, -out.x).
    const flipped = d[0] * out[1] - d[1] * out[0] < 0;
    const left = flipped ? q : p;
    return { left, right: [out[1], -out[0]], out, length, yaw: Math.atan2(out[0], out[1]) };
  });
}

/** A point `along` the edge from its left end, `off` outward, at height `y`. */
const onEdge = (e: Edge, along: number, off: number, y: number): Vec3 => [
  e.left[0] + e.right[0] * along + e.out[0] * off,
  y,
  e.left[1] + e.right[1] * along + e.out[1] * off,
];

/** A flat rectangle on the edge's face, `off` outward: CCW seen from outside. */
function panel(e: Edge, from: number, to: number, y0: number, y1: number, off: number) {
  return [
    onEdge(e, from, off, y0),
    onEdge(e, to, off, y0),
    onEdge(e, to, off, y1),
    onEdge(e, from, off, y1),
  ];
}

/** A box laid on the edge: `size` = [along, up, out], its base centre at `along`, `y`, `off`. */
export const onEdgeBox = (s: Surface, e: Edge, size: Vec3, along: number, y: number, off: number) =>
  transform(box(s, size), { at: onEdge(e, along, off, y), yaw: e.yaw });

export type CurtainOptions = {
  glass: Surface;
  mullion: Surface;
  floor: number;
  bay: number;
  lit: number;
  seed: number;
};

/** Glass, vertical mullions every bay, a spandrel per floor, a share of lit office cells. */
export function curtainWall(e: Edge, y0: number, height: number, o: CurtainOptions): MeshPart[] {
  const bays = Math.max(1, Math.round(e.length / o.bay)),
    floors = Math.max(1, Math.round(height / o.floor)),
    bay = e.length / bays,
    floor = height / floors,
    parts: MeshPart[] = [quads(o.glass, [panel(e, 0, e.length, y0, y0 + height, 0)])],
    lit: Vec3[][] = [];
  for (let i = 0; i <= bays; i++)
    parts.push(onEdgeBox(o.mullion, e, [0.14, height, 0.3], i * bay, y0, 0.05));
  for (let k = 0; k < floors; k++) {
    const y = y0 + k * floor;
    parts.push(onEdgeBox(CITY.spandrel, e, [e.length, 0.9, 0.16], e.length / 2, y, 0.06));
    for (let i = 0; i < bays; i++)
      if (hash01(o.seed, i, k, Math.round(e.yaw * 100)) < o.lit)
        lit.push(panel(e, i * bay + 0.15, (i + 1) * bay - 0.15, y + 0.95, y + floor - 0.1, 0.03));
  }
  if (lit.length) parts.push(quads(CITY.officeLit, lit));
  return parts;
}

export type PunchedOptions = {
  window: number;
  floor: number;
  bay: number;
  lit: number;
  seed: number;
  /** Balconies on every other bay from the first floor up, when set. */
  balcony?: Surface;
};

/** Framed windows centred in each bay of each floor; lit rooms glow; optional balconies. */
export function punchedWall(e: Edge, y0: number, floors: number, o: PunchedOptions): MeshPart[] {
  const bays = Math.max(1, Math.floor(e.length / o.bay)),
    bay = e.length / bays,
    parts: MeshPart[] = [],
    dark: Vec3[][] = [],
    lit: Vec3[][] = [];
  for (let k = 0; k < floors; k++)
    for (let i = 0; i < bays; i++) {
      const at = (i + 0.5) * bay,
        y = y0 + k * o.floor + 0.9,
        door = o.balcony && k > 0 && i % 2 === 0,
        h = door ? o.floor - 1.2 : o.floor * 0.5,
        yy = door ? y - 0.8 : y;
      parts.push(onEdgeBox(CITY.frame, e, [o.window + 0.24, h + 0.24, 0.1], at, yy - 0.12, 0));
      const target = hash01(o.seed, i, k, Math.round(e.yaw * 100)) < o.lit ? lit : dark;
      target.push(panel(e, at - o.window / 2, at + o.window / 2, yy, yy + h, 0.055));
      if (door) parts.push(...balcony(o.balcony!, e, at, yy - 0.2, o.window + 1.2));
    }
  if (dark.length) parts.push(quads(CITY.window, dark));
  if (lit.length) parts.push(quads(CITY.windowLit, lit));
  return parts;
}

/** A cantilevered slab with a solid front and two side rails. */
function balcony(s: Surface, e: Edge, at: number, y: number, width: number): MeshPart[] {
  return [
    onEdgeBox(CITY.renderGrey, e, [width, 0.2, 1.5], at, y, 0.75),
    onEdgeBox(s, e, [width, 1.05, 0.06], at, y + 0.2, 1.47),
    onEdgeBox(CITY.railing, e, [0.06, 1.05, 1.4], at - width / 2 + 0.03, y + 0.2, 0.75),
    onEdgeBox(CITY.railing, e, [0.06, 1.05, 1.4], at + width / 2 - 0.03, y + 0.2, 0.75),
  ];
}

/** A regular polygon of `sides`, circumradius `r`, first corner at angle `phase`. */
export const polygon = (sides: number, r: number, phase = 0): Point2[] =>
  Array.from({ length: sides }, (_, i) => {
    const a = phase + (2 * Math.PI * i) / sides;
    return [r * Math.cos(a), r * Math.sin(a)];
  });

/** A `w` × `d` rectangle centred on the origin, optionally with chamfered corners. */
export const rectangle = (w: number, d: number, chamfer = 0): Point2[] => {
  const x = w / 2,
    z = d / 2,
    c = chamfer;
  if (!c)
    return [
      [-x, -z],
      [x, -z],
      [x, z],
      [-x, z],
    ];
  return [
    [-x + c, -z],
    [x - c, -z],
    [x, -z + c],
    [x, z - c],
    [x - c, z],
    [-x + c, z],
    [-x, z - c],
    [-x, -z + c],
  ];
};
