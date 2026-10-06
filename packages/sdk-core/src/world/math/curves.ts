import { Vector2 } from './vector2.ts'
import { Vector3, readVec3, type Vec3Input } from './vector3.ts'
import { splineSpan } from './splineSpan.ts'

/** A parametric curve over `t ∈ [0, 1]`. */
export abstract class Curve {
  /** Always `true`: tells a curve apart from anything else. */
  readonly isCurve = true as const
  /** The point at `t`, from 0 (the start) to 1 (the end). */
  abstract getPoint(t: number, out?: Vector3): Vector3
  /** Points spread along the curve, `divisions + 1` of them. */
  getPoints(divisions = 5) {
    const points: Vector3[] = []
    for (let i = 0; i <= divisions; i++) points.push(this.getPoint(i / divisions))
    return points
  }
  /** Unit tangent by a central difference: the curve owes no derivative of its own. */
  getTangent(t: number, out = new Vector3()) {
    // Both points in new vectors, never in `out`: `Vector3.set` skips a write equal by `===`, so a
    // point at the origin written there would keep the signed zeros `out` held, and the tangent too.
    const h = 1e-4,
      a = this.getPoint(Math.max(0, t - h)),
      b = this.getPoint(Math.min(1, t + h))
    return out.subVectors(b, a).normalize()
  }
  /** How long the curve is, measured over `divisions` pieces. */
  getLength(divisions = 200) {
    // Two vectors take the points in turn; a distance squares its differences, so the sign of a
    // zero kept by a reused vector never reaches it.
    let length = 0,
      last = this.getPoint(0),
      next = new Vector3()
    for (let i = 1; i <= divisions; i++) {
      next = this.getPoint(i / divisions, next)
      length += next.distanceTo(last)
      const free = last
      last = next
      next = free
    }
    return length
  }
}

/** A cubic spline through its points whose tangent at each point is half the difference of its neighbours, closed on request. */
export class SplineCurve extends Curve {
  /** The points the curve passes through. */
  points: Vector3[]
  /** Whether the curve comes back to its first point. */
  closed: boolean
  constructor(points: Vector3[], closed = false) {
    super()
    this.points = points
    this.closed = closed
  }
  /** The point at `t` on the smooth curve. */
  getPoint(t: number, out = new Vector3()) {
    const { points, closed } = this,
      n = points.length
    // Stryker disable next-line ConditionalExpression: one point: all four neighbours are it
    if (n === 1) return out.copy(points[0])
    const span = closed ? n : n - 1
    const p = Math.min(Math.max(t, 0), 1) * span
    let i = Math.floor(p),
      w = p - i
    // Stryker disable next-line all: at t = 1, weight 0 past the last span reads the same point
    if (i >= span) {
      i = span - 1
      w = 1
    }
    const a = pointAt(points, closed, i - 1),
      b = pointAt(points, closed, i),
      c = pointAt(points, closed, i + 1),
      d = pointAt(points, closed, i + 2),
      w2 = w * w,
      w3 = w2 * w
    return out.set(
      splineSpan(a.x, b.x, c.x, d.x, w, w2, w3),
      splineSpan(a.y, b.y, c.y, d.y, w, w2, w3),
      splineSpan(a.z, b.z, c.z, d.z, w, w2, w3),
    )
  }
}

/** Point `k` of a spline: wrapped round a closed one; an open one repeats its end past it. */
function pointAt(points: readonly Vector3[], closed: boolean, k: number) {
  const n = points.length
  return points[closed ? (k + n) % n : Math.min(Math.max(k, 0), n - 1)]
}

/** Straight segments through every point, parameterised by arc length. */
export class Path extends Curve {
  /** The corners of the path. */
  readonly points: Vector3[]
  constructor(points: (Vec3Input | readonly [number, number])[] = []) {
    super()
    this.points = points.map((p) =>
      // Stryker disable next-line ConditionalExpression: a pair read as 3 numbers has z undefined
      Array.isArray(p) && p.length === 2
        ? new Vector3(p[0], p[1], 0)
        : new Vector3(...readVec3(p as Vec3Input)),
    )
  }
  /** The corners themselves: a path of straight segments is exactly its points. */
  override getPoints() {
    return this.points.map((p) => p.clone())
  }
  /** The point at `t` along the straight pieces, by length. */
  getPoint(t: number, out = new Vector3()) {
    const pts = this.points
    if (pts.length < 2) return out.copy(pts[0] ?? new Vector3())
    const lengths = [0]
    for (let i = 1; i < pts.length; i++)
      lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const target = Math.min(Math.max(t, 0), 1) * lengths[lengths.length - 1]
    let i = 1
    // Stryker disable next-line all: a corner is on both pieces; t is clamped to the last
    while (i < pts.length - 1 && lengths[i] < target) i++
    const piece = lengths[i] - lengths[i - 1] || 1
    return out.lerpVectors(pts[i - 1], pts[i], (target - lengths[i - 1]) / piece)
  }
}

/** A closed outline in the plane, with holes: what `geometry.shape` fills and `extrude` sweeps. */
export class Shape {
  /** Always `true`: tells a shape apart from anything else. */
  readonly isShape = true as const
  /** Outlines cut out of this one: shapes or paths, read in the plane. */
  readonly holes: (Shape | Path)[] = []
  /** The outline as drawn: each command appends points sampled at `curveSegments`. */
  private readonly commands: ((segments: number, out: Vector2[]) => void)[] = []
  private cursor = new Vector2()

  constructor(points?: readonly (readonly [number, number])[]) {
    if (points?.length) {
      this.moveTo(points[0][0], points[0][1])
      for (const [x, y] of points.slice(1)) this.lineTo(x, y)
    }
  }
  /** Starts the outline at `(x, y)`. */
  moveTo(x: number, y: number) {
    this.cursor = new Vector2(x, y)
    const at = this.cursor.clone()
    this.commands.push((_, out) => out.push(at))
    return this
  }
  /** Draws a straight line to `(x, y)`. */
  lineTo(x: number, y: number) {
    const to = new Vector2(x, y)
    this.cursor = to
    this.commands.push((_, out) => out.push(to.clone()))
    return this
  }
  /** Draws a curve to `(x, y)`, bent toward one control point. */
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    const from = this.cursor.clone()
    this.cursor = new Vector2(x, y)
    this.commands.push((segments, out) => {
      for (let i = 1; i <= segments; i++) {
        const t = i / segments,
          s = 1 - t
        out.push(
          new Vector2(
            s * s * from.x + 2 * s * t * cx + t * t * x,
            s * s * from.y + 2 * s * t * cy + t * t * y,
          ),
        )
      }
    })
    return this
  }
  /** Draws a curve to `(x, y)`, bent toward two control points. */
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const from = this.cursor.clone()
    this.cursor = new Vector2(x, y)
    this.commands.push((segments, out) => {
      for (let i = 1; i <= segments; i++) {
        const t = i / segments,
          s = 1 - t
        const f = (a: number, b: number, c: number, d: number) =>
          s * s * s * a + 3 * s * s * t * b + 3 * s * t * t * c + t * t * t * d
        out.push(new Vector2(f(from.x, c1x, c2x, x), f(from.y, c1y, c2y, y)))
      }
    })
    return this
  }
  /** A circular arc around `(x, y)`, from `start` to `end` radians. */
  absarc(x: number, y: number, radius: number, start: number, end: number, clockwise = false) {
    let sweep = end - start
    if (clockwise && sweep > 0) sweep -= Math.PI * 2
    if (!clockwise && sweep < 0) sweep += Math.PI * 2
    this.cursor = new Vector2(x + radius * Math.cos(end), y + radius * Math.sin(end))
    this.commands.push((segments, out) => {
      for (let i = 0; i <= segments; i++) {
        const a = start + (sweep * i) / segments
        out.push(new Vector2(x + radius * Math.cos(a), y + radius * Math.sin(a)))
      }
    })
    return this
  }
  /** The outline sampled, closing point dropped when it repeats the first. */
  getPoints(curveSegments = 12) {
    const out: Vector2[] = []
    for (const command of this.commands) command(curveSegments, out)
    if (out.length > 1 && out[0].distanceTo(out[out.length - 1]) < 1e-12) out.pop()
    return out
  }
}
