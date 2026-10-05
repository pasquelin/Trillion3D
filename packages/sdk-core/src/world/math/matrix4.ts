import { copyMatrix4, determinantMatrix4, multiplyMatrix4 } from '../../math/matrix/matrix4.ts';
import { composeMatrix4 } from '../../math/matrix/matrix4Compose.ts';
import { decomposeMatrix4 } from '../../math/matrix/matrix4Trs.ts';
import { invertMatrix4 } from '../../math/matrix/matrix4Inverse.ts';
import { axisAngleQuaternion } from '../../math/matrix/quaternion.ts';
import type { XYZSink as V, XYZWLike as Q, XYZWSink as QOut } from './likes.ts';
import { hypot3 } from '../../math/primitives/hypot.ts';

const t = new Float64Array(3),
  r = new Float64Array(4),
  s = new Float64Array(3),
  scratch = new Float64Array(16);
const ORIGIN = [0, 0, 0],
  UNIT = [1, 1, 1],
  IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** The 3×3 matrix, beside this one since the scene layer first read both from here. */
export { Matrix3 } from './matrix3.ts';

/** A 4×4 matrix, column-major, over the core's free functions (`mathMatrix4*.ts`). */
export class Matrix4 {
  /** Always `true`: tells a 4×4 matrix apart. */ readonly isMatrix4 = true as const;
  /** Sixteen numbers; a scene node rebinds them to its slot of the transform tree. */
  elements: Float64Array = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  /** Row-major arguments, as a matrix is written on paper. */
  // prettier-ignore
  set(n11: number, n12: number, n13: number, n14: number, n21: number, n22: number, n23: number, n24: number,
    n31: number, n32: number, n33: number, n34: number, n41: number, n42: number, n43: number, n44: number) {
    // Number by number, in the column-major order a list would be read: no list made.
    const e = this.elements;
    e[0] = n11;
    e[1] = n21;
    e[2] = n31;
    e[3] = n41;
    e[4] = n12;
    e[5] = n22;
    e[6] = n32;
    e[7] = n42;
    e[8] = n13;
    e[9] = n23;
    e[10] = n33;
    e[11] = n43;
    e[12] = n14;
    e[13] = n24;
    e[14] = n34;
    e[15] = n44;
    return this;
  }
  /** Resets to the matrix that changes nothing. */ identity() {
    this.elements.set(IDENTITY);
    return this;
  }
  /** Takes the numbers of another matrix. */ copy(m: { elements: ArrayLike<number> }) {
    copyMatrix4(this.elements, m.elements);
    return this;
  }
  /** A new matrix with the same numbers. */ clone() {
    return new Matrix4().copy(this);
  }
  /** Reads sixteen numbers from a list. */ fromArray(array: ArrayLike<number>, offset = 0) {
    copyMatrix4(this.elements, array, 0, offset);
    return this;
  }
  /** The sixteen numbers as a list. */ toArray(): number[] {
    return Array.from(this.elements);
  }
  /** This matrix times `m`: `m` applies first. */ multiply(m: Matrix4) {
    return this.multiplyMatrices(this, m);
  }
  /** `m` times this matrix: `m` applies last. */ premultiply(m: Matrix4) {
    return this.multiplyMatrices(m, this);
  }
  /** Becomes `a` times `b`. */ multiplyMatrices(a: Matrix4, b: Matrix4) {
    multiplyMatrix4(scratch, a.elements, b.elements);
    this.elements.set(scratch);
    return this;
  }
  /** Builds the matrix from a position, a rotation and a size. */
  compose(position: V, quaternion: Q, scale: V) {
    t[0] = position.x;
    t[1] = position.y;
    t[2] = position.z;
    r[0] = quaternion.x;
    r[1] = quaternion.y;
    r[2] = quaternion.z;
    r[3] = quaternion.w;
    s[0] = scale.x;
    s[1] = scale.y;
    s[2] = scale.z;
    composeMatrix4(this.elements, t, r, s);
    return this;
  }
  /** Splits the matrix into position, rotation and size. */
  decompose(position: V, quaternion: QOut, scale: V) {
    decomposeMatrix4(this.elements, t, r, s);
    position.set(t[0], t[1], t[2]);
    quaternion.set(r[0], r[1], r[2], r[3]);
    scale.set(s[0], s[1], s[2]);
    return this;
  }
  /** Becomes the matrix that undoes this one. */ invert() {
    invertMatrix4(this.elements, this.elements);
    return this;
  }
  /** How much the matrix scales volume; below 0 it mirrors. */ determinant() {
    return determinantMatrix4(this.elements);
  }
  /** Swaps rows and columns. */ transpose() {
    const e = this.elements;
    let v = e[1];
    e[1] = e[4];
    e[4] = v;
    v = e[2];
    e[2] = e[8];
    e[8] = v;
    v = e[3];
    e[3] = e[12];
    e[12] = v;
    v = e[6];
    e[6] = e[9];
    e[9] = v;
    v = e[7];
    e[7] = e[13];
    e[13] = v;
    v = e[11];
    e[11] = e[14];
    e[14] = v;
    return this;
  }
  /** Becomes a move by `(x, y, z)`. */ makeTranslation(x: number, y: number, z: number) {
    return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
  }
  /** Becomes a stretch by `(x, y, z)`. */ makeScale(x: number, y: number, z: number) {
    return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1);
  }
  /** Becomes the turn a quaternion makes. */ makeRotationFromQuaternion(q: Q) {
    r[0] = q.x;
    r[1] = q.y;
    r[2] = q.z;
    r[3] = q.w;
    composeMatrix4(this.elements, ORIGIN, r, UNIT);
    return this;
  }
  /** The rotation about `axis`, made unit first (`axisAngleQuaternion`). */
  makeRotationAxis(axis: { x: number; y: number; z: number }, angle: number) {
    const n = hypot3(axis.x, axis.y, axis.z) || 1;
    t[0] = axis.x / n;
    t[1] = axis.y / n;
    t[2] = axis.z / n;
    composeMatrix4(this.elements, ORIGIN, axisAngleQuaternion(r, t, angle), UNIT);
    return this;
  }
  /** Becomes a turn around x. */ makeRotationX(a: number) {
    return this.makeRotationAxis({ x: 1, y: 0, z: 0 }, a);
  }
  /** Becomes a turn around y. */ makeRotationY(a: number) {
    return this.makeRotationAxis({ x: 0, y: 1, z: 0 }, a);
  }
  /** Becomes a turn around z. */ makeRotationZ(a: number) {
    return this.makeRotationAxis({ x: 0, y: 0, z: 1 }, a);
  }
  /** Sets the move part only. */ setPosition(x: number, y: number, z: number) {
    this.elements[12] = x;
    this.elements[13] = y;
    this.elements[14] = z;
    return this;
  }
  /** The biggest stretch along any axis. */ getMaxScaleOnAxis() {
    const e = this.elements;
    return Math.sqrt(
      Math.max(
        e[0] * e[0] + e[1] * e[1] + e[2] * e[2],
        e[4] * e[4] + e[5] * e[5] + e[6] * e[6],
        e[8] * e[8] + e[9] * e[9] + e[10] * e[10],
      ),
    );
  }
  /** Whether two matrices hold the same numbers. */ equals(m: { elements: ArrayLike<number> }) {
    return this.elements.every((value, i) => value === m.elements[i]);
  }
}
