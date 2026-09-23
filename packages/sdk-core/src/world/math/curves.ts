import { Vector2 } from './vector2.ts';
import { Vector3, readVec3, type Vec3Input } from './vector3.ts';

/** A parametric curve over `t ∈ [0, 1]`. */
export abstract class Curve {
  readonly isCurve = true as const;
  abstract getPoint(t: number, out?: Vector3): Vector3;
  getPoints(divisions = 5) {
    const points: Vector3[] = [];
    for (let i = 0; i <= divisions; i++) points.push(this.getPoint(i / divisions));
    return points;
  }
  /** Unit tangent by a central difference: the curve owes no derivative of its own. */
  getTangent(t: number, out = new Vector3()) {
    const h = 1e-4,
      a = this.getPoint(Math.max(0, t - h)),
      b = this.getPoint(Math.min(1, t + h));
    return out.subVectors(b, a).normalize();
  }
  getLength(divisions = 200) {
    let length = 0,
      last = this.getPoint(0);
    for (let i = 1; i <= divisions; i++) {
      const next = this.getPoint(i / divisions);
      length += next.distanceTo(last);
      last = next;
    }
    return length;
  }
}

/** A smooth curve through every point: centripetal Catmull–Rom, closed on request. */
export class SplineCurve extends Curve {
  points: Vector3[];
  closed: boolean;
  constructor(points: Vector3[], closed = false) {
    super();
    this.points = points;
    this.closed = closed;
  }
  getPoint(t: number, out = new Vector3()) {
    const n = this.points.length;
    if (n === 1) return out.copy(this.points[0]);
    const span = this.closed ? n : n - 1;
    const p = Math.min(Math.max(t, 0), 1) * span;
    let i = Math.floor(p),
      w = p - i;
    if (i >= span) {
      i = span - 1;
      w = 1;
    }
    const at = (k: number) =>
      this.closed ? this.points[(k + n) % n] : this.points[Math.min(Math.max(k, 0), n - 1)];
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const axis = (a: number, b: number, c: number, d: number) => {
      const t0 = (c - a) * 0.5,
        t1 = (d - b) * 0.5,
        w2 = w * w,
        w3 = w2 * w;
      return (2 * b - 2 * c + t0 + t1) * w3 + (-3 * b + 3 * c - 2 * t0 - t1) * w2 + t0 * w + b;
    };
    return out.set(
      axis(p0.x, p1.x, p2.x, p3.x),
      axis(p0.y, p1.y, p2.y, p3.y),
      axis(p0.z, p1.z, p2.z, p3.z),
    );
  }
}

/** Straight segments through every point, parameterised by arc length. */
export class Path extends Curve {
  readonly points: Vector3[];
  constructor(points: (Vec3Input | readonly [number, number])[] = []) {
    super();
    this.points = points.map((p) =>
      Array.isArray(p) && p.length === 2
        ? new Vector3(p[0], p[1], 0)
        : new Vector3(...readVec3(p as Vec3Input)),
    );
  }
  /** The corners themselves: a path of straight segments is exactly its points. */
  override getPoints() {
    return this.points.map((p) => p.clone());
  }
  getPoint(t: number, out = new Vector3()) {
    const pts = this.points;
    if (pts.length < 2) return out.copy(pts[0] ?? new Vector3());
    const lengths = [0];
    for (let i = 1; i < pts.length; i++)
      lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const target = Math.min(Math.max(t, 0), 1) * lengths[lengths.length - 1];
    let i = 1;
    while (i < pts.length - 1 && lengths[i] < target) i++;
    const piece = lengths[i] - lengths[i - 1] || 1;
    return out.lerpVectors(pts[i - 1], pts[i], (target - lengths[i - 1]) / piece);
  }
}

/** A closed outline in the plane, with holes: what `geometry.shape` fills and `extrude` sweeps. */
export class Shape {
  readonly isShape = true as const;
  /** Outlines cut out of this one: shapes or paths, read in the plane. */
  readonly holes: (Shape | Path)[] = [];
  /** The outline as drawn: each command appends points sampled at `curveSegments`. */
  private readonly commands: ((segments: number, out: Vector2[]) => void)[] = [];
  private cursor = new Vector2();

  constructor(points?: readonly (readonly [number, number])[]) {
    if (points?.length) {
      this.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) this.lineTo(x, y);
    }
  }
  moveTo(x: number, y: number) {
    this.cursor = new Vector2(x, y);
    const at = this.cursor.clone();
    this.commands.push((_, out) => out.push(at));
    return this;
  }
  lineTo(x: number, y: number) {
    const to = new Vector2(x, y);
    this.cursor = to;
    this.commands.push((_, out) => out.push(to.clone()));
    return this;
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    const from = this.cursor.clone();
    this.cursor = new Vector2(x, y);
    this.commands.push((segments, out) => {
      for (let i = 1; i <= segments; i++) {
        const t = i / segments,
          s = 1 - t;
        out.push(
          new Vector2(
            s * s * from.x + 2 * s * t * cx + t * t * x,
            s * s * from.y + 2 * s * t * cy + t * t * y,
          ),
        );
      }
    });
    return this;
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const from = this.cursor.clone();
    this.cursor = new Vector2(x, y);
    this.commands.push((segments, out) => {
      for (let i = 1; i <= segments; i++) {
        const t = i / segments,
          s = 1 - t;
        const f = (a: number, b: number, c: number, d: number) =>
          s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d;
        out.push(new Vector2(f(from.x, c1x, c2x, x), f(from.y, c1y, c2y, y)));
      }
    });
    return this;
  }
  /** A circular arc around `(x, y)`, from `start` to `end` radians. */
  absarc(x: number, y: number, radius: number, start: number, end: number, clockwise = false) {
    let sweep = end - start;
    if (clockwise && sweep > 0) sweep -= Math.PI * 2;
    if (!clockwise && sweep < 0) sweep += Math.PI * 2;
    this.cursor = new Vector2(x + radius * Math.cos(end), y + radius * Math.sin(end));
    this.commands.push((segments, out) => {
      for (let i = 0; i <= segments; i++) {
        const a = start + (sweep * i) / segments;
        out.push(new Vector2(x + radius * Math.cos(a), y + radius * Math.sin(a)));
      }
    });
    return this;
  }
  /** The outline sampled, closing point dropped when it repeats the first. */
  getPoints(curveSegments = 12) {
    const out: Vector2[] = [];
    for (const command of this.commands) command(curveSegments, out);
    if (out.length > 1 && out[0].distanceTo(out[out.length - 1]) < 1e-12) out.pop();
    return out;
  }
}
