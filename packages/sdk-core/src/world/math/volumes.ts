import { frustumExcludesBox } from '../../math/frustum/frustumBox.ts';
import { frustumPlanesFromMatrix } from '../../math/frustum/frustum.ts';
import { Vector3 } from './vector3.ts';
import type { Box3 } from './box3.ts';
import type { Matrix4 } from './matrix4.ts';
import type { XYZLike as XYZ } from './likes.ts';

/** A ball: centre and radius; a negative radius is the empty sphere. */
export class Sphere {
  readonly isSphere = true as const;
  center: Vector3;
  radius: number;
  constructor(center = new Vector3(), radius = -1) {
    this.center = center;
    this.radius = radius;
  }
  set(center: XYZ, radius: number) {
    this.center.copy(center);
    this.radius = radius;
    return this;
  }
  isEmpty() {
    return this.radius < 0;
  }
  containsPoint(p: XYZ) {
    return this.center.distanceToSquared(p) <= this.radius * this.radius;
  }
  distanceToPoint(p: XYZ) {
    return this.center.distanceTo(p) - this.radius;
  }
  clone() {
    return new Sphere(this.center.clone(), this.radius);
  }
}

/** `normal · p + constant = 0`, the normal unit length. */
export class Plane {
  readonly isPlane = true as const;
  normal: Vector3;
  constant: number;
  constructor(normal = new Vector3(1, 0, 0), constant = 0) {
    this.normal = normal;
    this.constant = constant;
  }
  set(normal: XYZ, constant: number) {
    this.normal.copy(normal);
    this.constant = constant;
    return this;
  }
  setFromNormalAndCoplanarPoint(normal: XYZ, point: XYZ) {
    this.normal.copy(normal);
    this.constant = -this.normal.dot(point);
    return this;
  }
  distanceToPoint(p: XYZ) {
    return this.normal.dot(p) + this.constant;
  }
  projectPoint(p: XYZ, out = new Vector3()) {
    return out.copy(p).addScaledVector(this.normal, -this.distanceToPoint(p));
  }
  clone() {
    return new Plane(this.normal.clone(), this.constant);
  }
}

/** A half-line: origin and unit direction. */
export class Ray {
  readonly isRay = true as const;
  origin: Vector3;
  direction: Vector3;
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin;
    this.direction = direction;
  }
  set(origin: XYZ, direction: XYZ) {
    this.origin.copy(origin);
    this.direction.copy(direction);
    return this;
  }
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
  clone() {
    return new Ray(this.origin.clone(), this.direction.clone());
  }
}

/** Three corners, wound counter-clockwise for the front face. */
export class Triangle {
  readonly isTriangle = true as const;
  a: Vector3;
  b: Vector3;
  c: Vector3;
  constructor(a = new Vector3(), b = new Vector3(), c = new Vector3()) {
    this.a = a;
    this.b = b;
    this.c = c;
  }
  set(a: XYZ, b: XYZ, c: XYZ) {
    this.a.copy(a);
    this.b.copy(b);
    this.c.copy(c);
    return this;
  }
  getNormal(out = new Vector3()) {
    const edge = new Vector3().subVectors(this.a, this.b);
    return out.subVectors(this.c, this.b).cross(edge).normalize();
  }
  getArea() {
    const edge = new Vector3().subVectors(this.a, this.b);
    return new Vector3().subVectors(this.c, this.b).cross(edge).length() * 0.5;
  }
  getMidpoint(out = new Vector3()) {
    return out
      .addVectors(this.a, this.b)
      .add(this.c)
      .multiplyScalar(1 / 3);
  }
}

/** Six planes, read from a view-projection by the core (`mathFrustum.ts`). */
export class Frustum {
  readonly isFrustum = true as const;
  /** Six normalised planes, four numbers each: the core's layout. */
  readonly planes = new Float64Array(24);

  setFromProjectionMatrix(m: Matrix4) {
    frustumPlanesFromMatrix(this.planes, m.elements);
    return this;
  }
  intersectsBox(b: Box3) {
    return !frustumExcludesBox(this.planes, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
  }
  containsPoint(p: XYZ) {
    const planes = this.planes;
    for (let i = 0; i < 24; i += 4)
      if (planes[i] * p.x + planes[i + 1] * p.y + planes[i + 2] * p.z + planes[i + 3] < 0)
        return false;
    return true;
  }
}
