/**
 * Ground-plane geometry of the city: headings, oriented rectangles (the footprint of every prop),
 * their overlap, their distance to a road, and a hash grid that keeps those tests local.
 * Headings follow `Instance.yaw`: a yaw turns the prop's +X toward (cos, -sin) and its +Z toward
 * (sin, cos) on the ground (x, z).
 */
import type { Vec3 } from '../../plan/contract.ts';

export type Xz = readonly [number, number];

/** A local ground offset `(x, z)` turned by `yaw` into world axes. */
export const turn = ([x, z]: Xz, yaw: number): Xz => [
  x * Math.cos(yaw) + z * Math.sin(yaw),
  -x * Math.sin(yaw) + z * Math.cos(yaw),
];

/** The yaw that turns a prop's +Z toward the ground direction `(dx, dz)`. */
export const headingOf = ([dx, dz]: Xz) => Math.atan2(dx, dz);

/**
 * A marker's yaw facing the ground direction `(dx, dz)`, in the play layer's convention: at yaw
 * 0 a viewer or a vehicle looks toward -Z.
 */
export const facing = ([dx, dz]: Xz) => Math.atan2(-dx, -dz);

/** The yaw that turns a prop's +X toward the ground direction `(dx, dz)`. */
export const sidewaysOf = ([dx, dz]: Xz) => Math.atan2(-dz, dx);

/** An oriented rectangle: centre, half extents along the prop's own X and Z, and its yaw. */
export type Obb = { centre: Xz; half: Xz; yaw: number };

export const corners = ({ centre, half, yaw }: Obb): Xz[] =>
  (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([sx, sz]) => {
    const [x, z] = turn([sx * half[0], sz * half[1]], yaw);
    return [centre[0] + x, centre[1] + z];
  });

const axesOf = (yaw: number): Xz[] => [turn([1, 0], yaw), turn([0, 1], yaw)];

/** Separating-axis test: true when the two rectangles share more than `gap` of area. */
export function overlaps(a: Obb, b: Obb, gap = 0): boolean {
  const ca = corners(a),
    cb = corners(b);
  for (const axis of [...axesOf(a.yaw), ...axesOf(b.yaw)]) {
    const project = (points: Xz[]) => points.map(([x, z]) => x * axis[0] + z * axis[1]);
    const pa = project(ca),
      pb = project(cb);
    if (Math.min(...pa) >= Math.max(...pb) - gap || Math.min(...pb) >= Math.max(...pa) - gap)
      return false;
  }
  return true;
}

const pointSegment = ([px, pz]: Xz, [ax, az]: Xz, [bx, bz]: Xz) => {
  const dx = bx - ax,
    dz = bz - az,
    length = dx * dx + dz * dz,
    t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
};

/** A road segment `a → b` of `halfWidth` as a rectangle, lengthened to close its joints. */
export function segmentBox(a: Xz, b: Xz, halfWidth: number): Obb {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  return {
    centre: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    half: [Math.hypot(dx, dz) / 2 + halfWidth, halfWidth],
    yaw: sidewaysOf([dx, dz]),
  };
}

/** Distance from a point to a polyline on the ground. */
export const polylineDistance = (p: Xz, points: readonly Vec3[]) => {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++)
    best = Math.min(best, pointSegment(p, xz(points[i]), xz(points[i + 1])));
  return best;
};

export const xz = (p: Vec3): Xz => [p[0], p[2]];

/** The rectangle's ground radius: the farthest a corner reaches from its centre. */
const reach = (box: Obb) => Math.hypot(box.half[0], box.half[1]);

/** A uniform hash grid of rectangles on the ground, so each query reads only its neighbours. */
export class Occupancy<T> {
  private readonly cells = new Map<string, { box: Obb; value: T }[]>();
  private readonly cell: number;
  constructor(cell: number) {
    this.cell = cell;
  }

  private keys(box: Obb): string[] {
    const r = reach(box),
      keys: string[] = [];
    for (
      let i = Math.floor((box.centre[0] - r) / this.cell);
      i * this.cell <= box.centre[0] + r;
      i++
    )
      for (
        let j = Math.floor((box.centre[1] - r) / this.cell);
        j * this.cell <= box.centre[1] + r;
        j++
      )
        keys.push(`${i},${j}`);
    return keys;
  }

  add(box: Obb, value: T) {
    for (const key of this.keys(box)) {
      const list = this.cells.get(key);
      if (list) list.push({ box, value });
      else this.cells.set(key, [{ box, value }]);
    }
  }

  /** Every stored value whose rectangle overlaps `box` by more than `gap`. */
  hits(box: Obb, gap = 0): T[] {
    const found = new Set<T>();
    for (const key of this.keys(box))
      for (const entry of this.cells.get(key) ?? [])
        if (!found.has(entry.value) && overlaps(entry.box, box, gap)) found.add(entry.value);
    return [...found];
  }
}
