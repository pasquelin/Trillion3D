import { copyMatrix4, determinantMatrix4, multiplyMatrix4 } from '../../mathMatrix4.ts';
import { composeMatrix4 } from '../../mathMatrix4Compose.ts';
import { decomposeMatrix4 } from '../../mathMatrix4Trs.ts';
import { invertMatrix4 } from '../../mathMatrix4Inverse.ts';
import { normalMatrix3 } from '../../mathMatrix3.ts';
import type { XYZSink as V, XYZWLike as Q, XYZWSink as QOut } from './likes.ts';

const t = new Float64Array(3),
  r = new Float64Array(4),
  s = new Float64Array(3),
  scratch = new Float64Array(16);

/** A 4×4 matrix, column-major, over the core's free functions (`mathMatrix4*.ts`). */
export class Matrix4 {
  readonly isMatrix4 = true as const;
  /** Sixteen numbers; a scene node rebinds them to its slot of the transform tree. */
  elements: Float64Array = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  /** Row-major arguments, as a matrix is written on paper. */
  // prettier-ignore
  set(n11: number, n12: number, n13: number, n14: number, n21: number, n22: number, n23: number, n24: number,
    n31: number, n32: number, n33: number, n34: number, n41: number, n42: number, n43: number, n44: number) {
    this.elements.set([n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44]);
    return this;
  }
  identity() {
    this.elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return this;
  }
  copy(m: { elements: ArrayLike<number> }) {
    copyMatrix4(this.elements, m.elements);
    return this;
  }
  clone() {
    return new Matrix4().copy(this);
  }
  fromArray(array: ArrayLike<number>, offset = 0) {
    copyMatrix4(this.elements, array, 0, offset);
    return this;
  }
  toArray(): number[] {
    return Array.from(this.elements);
  }
  multiply(m: Matrix4) {
    return this.multiplyMatrices(this, m);
  }
  premultiply(m: Matrix4) {
    return this.multiplyMatrices(m, this);
  }
  multiplyMatrices(a: Matrix4, b: Matrix4) {
    multiplyMatrix4(scratch, a.elements, b.elements);
    this.elements.set(scratch);
    return this;
  }
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
  decompose(position: V, quaternion: QOut, scale: V) {
    decomposeMatrix4(this.elements, t, r, s);
    position.set(t[0], t[1], t[2]);
    quaternion.set(r[0], r[1], r[2], r[3]);
    scale.set(s[0], s[1], s[2]);
    return this;
  }
  invert() {
    invertMatrix4(this.elements, this.elements);
    return this;
  }
  determinant() {
    return determinantMatrix4(this.elements);
  }
  transpose() {
    const e = this.elements;
    for (const [i, j] of [
      [1, 4],
      [2, 8],
      [3, 12],
      [6, 9],
      [7, 13],
      [11, 14],
    ])
      [e[i], e[j]] = [e[j], e[i]];
    return this;
  }
  makeTranslation(x: number, y: number, z: number) {
    return this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1);
  }
  makeScale(x: number, y: number, z: number) {
    return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1);
  }
  makeRotationFromQuaternion(q: Q) {
    r[0] = q.x;
    r[1] = q.y;
    r[2] = q.z;
    r[3] = q.w;
    composeMatrix4(this.elements, [0, 0, 0], r, [1, 1, 1]);
    return this;
  }
  makeRotationAxis(axis: { x: number; y: number; z: number }, angle: number) {
    const n = Math.hypot(axis.x, axis.y, axis.z) || 1,
      h = Math.sin(angle / 2) / n;
    return this.makeRotationFromQuaternion({
      x: axis.x * h,
      y: axis.y * h,
      z: axis.z * h,
      w: Math.cos(angle / 2),
    });
  }
  makeRotationX(a: number) {
    return this.makeRotationAxis({ x: 1, y: 0, z: 0 }, a);
  }
  makeRotationY(a: number) {
    return this.makeRotationAxis({ x: 0, y: 1, z: 0 }, a);
  }
  makeRotationZ(a: number) {
    return this.makeRotationAxis({ x: 0, y: 0, z: 1 }, a);
  }
  setPosition(x: number, y: number, z: number) {
    this.elements[12] = x;
    this.elements[13] = y;
    this.elements[14] = z;
    return this;
  }
  getMaxScaleOnAxis() {
    const e = this.elements;
    return Math.sqrt(
      Math.max(
        e[0] * e[0] + e[1] * e[1] + e[2] * e[2],
        e[4] * e[4] + e[5] * e[5] + e[6] * e[6],
        e[8] * e[8] + e[9] * e[9] + e[10] * e[10],
      ),
    );
  }
  equals(m: { elements: ArrayLike<number> }) {
    return this.elements.every((value, i) => value === m.elements[i]);
  }
}

/** A 3×3 matrix, column-major: a normal transform, a texture transform. */
export class Matrix3 {
  readonly isMatrix3 = true as const;
  readonly elements = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  // prettier-ignore
  set(n11: number, n12: number, n13: number, n21: number, n22: number, n23: number,
    n31: number, n32: number, n33: number) {
    this.elements.set([n11, n21, n31, n12, n22, n32, n13, n23, n33]);
    return this;
  }
  identity() {
    return this.set(1, 0, 0, 0, 1, 0, 0, 0, 1);
  }
  copy(m: { elements: ArrayLike<number> }) {
    this.elements.set(Array.from(m.elements).slice(0, 9));
    return this;
  }
  clone() {
    return new Matrix3().copy(this);
  }
  setFromMatrix4(m: Matrix4) {
    const e = m.elements;
    return this.set(e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]);
  }
  /** Inverse transpose of the upper 3×3: what carries normals under `m`. */
  getNormalMatrix(m: Matrix4) {
    normalMatrix3(this.elements, m.elements);
    return this;
  }
  toArray(): number[] {
    return Array.from(this.elements);
  }
}
