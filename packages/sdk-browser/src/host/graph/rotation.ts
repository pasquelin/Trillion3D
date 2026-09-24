/**
 * THE ROTATION OF A POSE THE ENGINE'S OWN GRAPH HOLDS: a quaternion and its angles.
 *
 * Not a second math library: every number is the core's (`localTurnQuaternion`,
 * `writeRotationQuaternion`, the core `Euler`). What these add is the SHAPE the host-graph
 * contracts read (`../scene/graphNodes.ts`): two faces of one rotation, each announcing its
 * writes through a callback the other chains, which the watch's hook extends
 * (`../scene/hooks.ts`). The core's own `Quaternion` and `Euler` announce theirs otherwise.
 */
import { localTurnQuaternion } from '../../../../sdk-core/src/math/matrix/quaternion.ts';
import { writeRotationQuaternion } from '../../../../sdk-core/src/math/matrix/matrix4Trs.ts';
import { Euler } from '../../../../sdk-core/src/world/math/euler.ts';

/** The callback a face of a rotation calls after a write; nothing until an owner chains one. */
function silent() {}

/** Accessors over `_key` on `prototype`, each write announced through `_onChangeCallback`. */
function announced(prototype: object, keys: readonly string[]) {
  type Face = Record<string, unknown> & { _onChangeCallback(): void };
  for (const key of keys)
    Object.defineProperty(prototype, key, {
      get(this: Face) {
        return this[`_${key}`];
      },
      set(this: Face, value: unknown) {
        this[`_${key}`] = value;
        this._onChangeCallback();
      },
    });
}

/** An orientation `(x, y, z, w)` whose writes call `_onChangeCallback`. */
export class GraphRotation {
  _x: number;
  _y: number;
  _z: number;
  _w: number;
  /** The four numbers, each write announced. */
  declare x: number;
  declare y: number;
  declare z: number;
  declare w: number;
  /** Called after every write; replaced through `_onChange`. */
  _onChangeCallback: () => void = silent;
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
  }
  /** Writes the four numbers, announced once. */
  set(x: number, y: number, z: number, w: number) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
    this._onChangeCallback();
    return this;
  }
  /** Takes another rotation's numbers. */
  copy(q: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }) {
    return this.set(q.x, q.y, q.z, q.w);
  }
  /** Reads four numbers from a list. */
  fromArray(array: ArrayLike<number>, offset = 0) {
    return this.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3]);
  }
  /** The rotation of `angles`, in their order (`localTurnQuaternion`); announced unless `quiet`. */
  setFromAngles(angles: GraphAngles, quiet = false) {
    localTurnQuaternion(turn, angles._x, angles._y, angles._z, angles._order);
    this._x = turn[0];
    this._y = turn[1];
    this._z = turn[2];
    this._w = turn[3];
    if (!quiet) this._onChangeCallback();
    return this;
  }
  /** The rotation of the upper 3×3 of a column-major matrix whose columns are unit length. */
  setFromRotationMatrix(m: ArrayLike<number>) {
    rows.set([m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]);
    writeRotationQuaternion(turn, rows);
    return this.set(turn[0], turn[1], turn[2], turn[3]);
  }
  /** Becomes `q` followed by this rotation, `q · this`. */
  premultiply(q: GraphRotation) {
    const [ax, ay, az, aw] = [q._x, q._y, q._z, q._w];
    const [bx, by, bz, bw] = [this._x, this._y, this._z, this._w];
    return this.set(
      ax * bw + aw * bx + ay * bz - az * by,
      ay * bw + aw * by + az * bx - ax * bz,
      az * bw + aw * bz + ax * by - ay * bx,
      aw * bw - ax * bx - ay * by - az * bz,
    );
  }
  /** Becomes the opposite turn. */
  invert() {
    return this.set(-this._x, -this._y, -this._z, this._w);
  }
  /** Chains nothing: `callback` becomes what a write calls. */
  _onChange(callback: () => void) {
    this._onChangeCallback = callback;
    return this;
  }
}

/** Scratch of the conversions below: nothing allocates per write. */
const turn = new Float64Array(4),
  rows = new Float64Array(9),
  angles = new Euler();

/** The same orientation as three angles and their order, announcing its writes the same way. */
export class GraphAngles {
  _x = 0;
  _y = 0;
  _z = 0;
  _order = 'XYZ';
  /** The three angles and their order, each write announced. */
  declare x: number;
  declare y: number;
  declare z: number;
  declare order: string;
  /** Called after every write; replaced through `_onChange`. */
  _onChangeCallback: () => void = silent;
  /** Writes the three angles, and the order when given; announced once. */
  set(x: number, y: number, z: number, order = this._order) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._order = order;
    this._onChangeCallback();
    return this;
  }
  /** The angles of `q` in this order (the core `Euler`); announced unless `quiet`. */
  setFromRotation(q: GraphRotation, quiet = false) {
    angles.setFromQuaternion(q, this._order, true);
    this._x = angles.x;
    this._y = angles.y;
    this._z = angles.z;
    if (!quiet) this._onChangeCallback();
    return this;
  }
  /** Chains nothing: `callback` becomes what a write calls. */
  _onChange(callback: () => void) {
    this._onChangeCallback = callback;
    return this;
  }
}

announced(GraphRotation.prototype, ['x', 'y', 'z', 'w']);
announced(GraphAngles.prototype, ['x', 'y', 'z', 'order']);
