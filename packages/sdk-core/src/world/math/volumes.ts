import { frustumExcludesBox } from '../../math/frustum/box.ts';
import { frustumPlanesFromMatrix } from '../../math/frustum/frustum.ts';
import { Vector3 } from './vector3.ts';
import type { Box3 } from './box3.ts';
import type { Matrix4 } from './matrix4.ts';
import type { XYZLike as XYZ } from './likes.ts';

/** A ball: centre and radius; a negative radius is the empty sphere. */
export class Sphere {
  /** Always `true`: tells a sphere apart from anything else. */
  readonly isSphere = true as const;
  /** The middle of the ball. */
  center: Vector3;
  /** The distance from the middle to the edge; below 0 means empty. */
  radius: number;
  constructor(center = new Vector3(), radius = -1) {
    this.center = center;
    this.radius = radius;
  }
  /** Sets the middle and the radius. */
  set(center: XYZ, radius: number) {
    this.center.copy(center);
    this.radius = radius;
    return this;
  }
  /** Whether the ball holds nothing. */
  isEmpty() {
    return this.radius < 0;
  }
  /** Whether a point is inside the ball. */
  containsPoint(p: XYZ) {
    return this.center.distanceToSquared(p) <= this.radius * this.radius;
  }
  /** How far a point is from the ball's surface; negative inside. */
  distanceToPoint(p: XYZ) {
    return this.center.distanceTo(p) - this.radius;
  }
  /** A new ball with the same middle and radius. */
  clone() {
    return new Sphere(this.center.clone(), this.radius);
  }
}

/** `normal · p + constant = 0`, the normal unit length. */
export class Plane {
  /** Always `true`: tells a plane apart from anything else. */
  readonly isPlane = true as const;
  /** The arrow standing straight out of the plane. */
  normal: Vector3;
  /** The signed distance from the origin to the plane, along the normal. */
  constant: number;
  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.normal = normal;
    this.constant = constant;
  }
  /** Sets the normal and the distance. */
  set(normal: XYZ, constant: number) {
    this.normal.copy(normal);
    this.constant = constant;
    return this;
  }
  /** The plane through `point`, facing along `normal`. */
  setFromNormalAndCoplanarPoint(normal: XYZ, point: XYZ) {
    this.normal.copy(normal);
    this.constant = -this.normal.dot(point);
    return this;
  }
  /** How far a point is from the plane; negative behind it. */
  distanceToPoint(p: XYZ) {
    return this.normal.dot(p) + this.constant;
  }
  /** The point of the plane closest to `p`. */
  projectPoint(p: XYZ, out = new Vector3()) {
    return out.copy(p).addScaledVector(this.normal, -this.distanceToPoint(p));
  }
  /** A new plane with the same normal and distance. */
  clone() {
    return new Plane(this.normal.clone(), this.constant);
  }
}

/** A half-line: origin and unit direction. */
export class Ray {
  /** Always `true`: tells a ray apart from anything else. */
  readonly isRay = true as const;
  /** Where the ray starts. */
  origin: Vector3;
  /** Which way the ray goes. */
  direction: Vector3;
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin;
    this.direction = direction;
  }
  /** Sets the start and the direction. */
  set(origin: XYZ, direction: XYZ) {
    this.origin.copy(origin);
    this.direction.copy(direction);
    return this;
  }
  /** The point `t` along the ray. */
  at(t: number, out = new Vector3()) {
    return out.copy(this.origin).addScaledVector(this.direction, t);
  }
  /** Distance along the ray to the plane, or null when it never meets it ahead. */
  distanceToPlane(plane: Plane) {
    const denominator = plane.normal.dot(this.direction);
    if (denominator === 0) return plane.distanceToPoint(this.origin) === 0 ? 0 : null;
    const t = -(this.origin.dot(plane.normal) + plane.constant) / denominator;
    return t >= 0 ? t : null;
  }
  /** Slab test; the entry point, or null when the ray misses the box. */
  intersectBox(box: Box3, out = new Vector3()) {
    let near = -Infinity,
      far = Infinity;
    for (const axis of ['x', 'y', 'z'] as const) {
      const inverse = 1 / this.direction[axis];
      let t0 = (box.min[axis] - this.origin[axis]) * inverse,
        t1 = (box.max[axis] - this.origin[axis]) * inverse;
      if (t0 > t1) [t0, t1] = [t1, t0];
      near = Math.max(near, t0);
      far = Math.min(far, t1);
    }
    if (far < Math.max(near, 0)) return null;
    return this.at(near >= 0 ? near : far, out);
  }
  /** A new ray with the same start and direction. */
  clone() {
    return new Ray(this.origin.clone(), this.direction.clone());
  }
}

/** Three corners, wound counter-clockwise for the front face. */
export class Triangle {
  /** Always `true`: tells a triangle apart from anything else. */
  readonly isTriangle = true as const;
  /** The first corner. */
  a: Vector3;
  /** The second corner. */
  b: Vector3;
  /** The third corner. */
  c: Vector3;
  constructor(a = new Vector3(), b = new Vector3(), c = new Vector3()) {
    this.a = a;
    this.b = b;
    this.c = c;
  }
  /** Sets the three corners. */
  set(a: XYZ, b: XYZ, c: XYZ) {
    this.a.copy(a);
    this.b.copy(b);
    this.c.copy(c);
    return this;
  }
  /** The arrow standing straight out of the triangle. */
  getNormal(out = new Vector3()) {
    const edge = new Vector3().subVectors(this.a, this.b);
    return out.subVectors(this.c, this.b).cross(edge).normalize();
  }
  /** How much surface the triangle covers. */
  getArea() {
    const edge = new Vector3().subVectors(this.a, this.b);
    return new Vector3().subVectors(this.c, this.b).cross(edge).length() * 0.5;
  }
  /** The middle of the three corners. */
  getMidpoint(out = new Vector3()) {
    return out
      .addVectors(this.a, this.b)
      .add(this.c)
      .multiplyScalar(1 / 3);
  }
}

/** Six planes, read from a view-projection by the core (`math/frustum/frustum.ts`). */
export class Frustum {
  /** Always `true`: tells a frustum apart from anything else. */
  readonly isFrustum = true as const;
  /** Six normalised planes, four numbers each: the core's layout. */
  readonly planes = new Float64Array(24);

  /** The six planes of what a camera matrix sees. */
  setFromProjectionMatrix(m: Matrix4) {
    frustumPlanesFromMatrix(this.planes, m.elements);
    return this;
  }
  /** Whether a box is at least partly in view. */
  intersectsBox(b: Box3) {
    return !frustumExcludesBox(this.planes, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
  }
  /** Whether a point is in view. */
  containsPoint(p: XYZ) {
    const planes = this.planes;
    for (let i = 0; i < 24; i += 4)
      if (planes[i] * p.x + planes[i + 1] * p.y + planes[i + 2] * p.z + planes[i + 3] < 0)
        return false;
    return true;
  }
}
