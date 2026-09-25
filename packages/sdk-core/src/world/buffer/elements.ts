/**
 * What every vertex attribute shares, owning its storage or viewing one slice of an interleaved
 * buffer: reading and writing a vertex by component. The rule is the reference's, number for
 * number: an integer attribute declared normalised reads as its value over the largest of its type.
 */
/** The typed arrays a buffer holds. */
export type BufferTypedArray =
  | Float64Array
  | Float32Array
  | Uint32Array
  | Uint16Array
  | Uint8Array
  | Int32Array
  | Int16Array
  | Int8Array;

/** The largest value of each integer type: what a normalised element is read over. */
const SCALES = new Map<unknown, [scale: number, signed: boolean]>([
  [Uint32Array, [4294967295.0, false]],
  [Uint16Array, [65535.0, false]],
  [Uint8Array, [255.0, false]],
  [Int32Array, [2147483647.0, true]],
  [Int16Array, [32767.0, true]],
  [Int8Array, [127.0, true]],
]);

/** What one unit of a normalised element of `type` is worth (1 for a float type). */
export const normalisedUnit = (type: unknown) => 1 / (SCALES.get(type)?.[0] ?? 1);

/** A stored element read as the number it stands for. */
function denormalize(value: number, array: BufferTypedArray) {
  const scale = SCALES.get(array.constructor);
  if (!scale) return value;
  return scale[1] ? Math.max(value / scale[0], -1) : value / scale[0];
}

/** A number written as the element that stands for it. */
function normalize(value: number, array: BufferTypedArray) {
  const scale = SCALES.get(array.constructor);
  return scale ? Math.round(value * scale[0]) : value;
}

/** The elements of one vertex attribute, read and written by component. */
export abstract class VertexElements {
  /** The name a morph target is known by; empty for the others. */
  name = '';
  /** How many numbers belong to one vertex: 3 for a position. */
  readonly itemSize: number;
  /** Whether whole numbers are read as values between 0 and 1. */
  normalized: boolean;
  constructor(itemSize: number, normalized: boolean) {
    this.itemSize = itemSize;
    this.normalized = normalized;
  }
  /** The storage the elements live in. */
  abstract get array(): BufferTypedArray;
  /** How many vertices the numbers describe. */
  abstract get count(): number;
  /** Where number 0 of vertex `index` lies in `array`. */
  protected abstract at(index: number): number;
  /** Number `component` of vertex `index` as it is stored, a normalised integer unscaled. */
  stored(index: number, component: number) {
    return this.array[this.at(index) + component];
  }
  /** Number `component` of vertex `index`, read as the number it stands for. */
  getComponent(index: number, component: number) {
    const value = this.stored(index, component);
    return this.normalized ? denormalize(value, this.array) : value;
  }
  /** Writes number `component` of vertex `index`. */
  setComponent(index: number, component: number, value: number) {
    this.array[this.at(index) + component] = this.normalized ? normalize(value, this.array) : value;
    return this;
  }
  /** The first number of vertex `i`. */
  getX(i: number) {
    return this.getComponent(i, 0);
  }
  /** The second number of vertex `i`. */
  getY(i: number) {
    return this.getComponent(i, 1);
  }
  /** The third number of vertex `i`. */
  getZ(i: number) {
    return this.getComponent(i, 2);
  }
  /** The fourth number of vertex `i`. */
  getW(i: number) {
    return this.getComponent(i, 3);
  }
  /** Writes the first number of vertex `i`. */
  setX(i: number, x: number) {
    return this.setComponent(i, 0, x);
  }
  /** Writes the second number of vertex `i`. */
  setY(i: number, y: number) {
    return this.setComponent(i, 1, y);
  }
  /** Writes the third number of vertex `i`. */
  setZ(i: number, z: number) {
    return this.setComponent(i, 2, z);
  }
  /** Writes the fourth number of vertex `i`. */
  setW(i: number, w: number) {
    return this.setComponent(i, 3, w);
  }
  /** Writes two numbers for vertex `i`. */
  setXY(i: number, x: number, y: number) {
    return this.setX(i, x).setY(i, y);
  }
  /** Writes three numbers for vertex `i`. */
  setXYZ(i: number, x: number, y: number, z: number) {
    return this.setX(i, x).setY(i, y).setZ(i, z);
  }
}
