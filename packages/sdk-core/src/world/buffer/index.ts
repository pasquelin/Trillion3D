import type { PageAttribute } from '../../../../page-codec/pageAttributes.ts';
/** Numbers a buffer is written from. */
export type BufferNumbers = ArrayLike<number> | ArrayBufferView;
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

/** A typed array of per-vertex values, `itemSize` numbers per vertex: the page codec's
 *  `PageAttribute` (`page-codec/pageAttributes.ts`), with what a page writes into it. */
export class BufferAttribute implements PageAttribute {
  /** Always `true`: tells a buffer attribute apart from anything else. */
  readonly isBufferAttribute = true as const;
  /** How the values were declared; a half-float attribute is held at float precision. */
  readonly type: string;
  /** Whether whole numbers are read as values between 0 and 1. */
  normalized = false;
  /** Bumped by every declared write: what the world compares to see the content changed. */
  version = 0;
  /** Called when the attribute is declared written; set by the geometry that holds it. */
  _onChange: (() => void) | null = null;

  /** The numbers themselves. */
  readonly array: BufferTypedArray;
  /** How many numbers belong to one vertex: 3 for a position. */
  readonly itemSize: number;
  constructor(array: BufferTypedArray, itemSize: number, type = array.constructor.name) {
    this.array = array;
    this.itemSize = itemSize;
    this.type = type;
  }
  /** How many vertices the numbers describe. */
  get count() {
    return Math.floor(this.array.length / this.itemSize);
  }
  /** `attribute.needsUpdate = true` after writing `array`: the world re-reads it. */
  set needsUpdate(value: boolean) {
    if (!value) return;
    this.version++;
    this._onChange?.();
  }
  get needsUpdate() {
    return false;
  }
  /** Number `component` of vertex `index`. */
  getComponent(index: number, component: number) {
    return this.array[index * this.itemSize + component];
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
  /** Writes three numbers for vertex `i`. */
  setXYZ(i: number, x: number, y: number, z: number) {
    const at = i * this.itemSize;
    this.array[at] = x;
    this.array[at + 1] = y;
    this.array[at + 2] = z;
    return this;
  }
  /** Writes two numbers for vertex `i`. */
  setXY(i: number, x: number, y: number) {
    this.array[i * this.itemSize] = x;
    this.array[i * this.itemSize + 1] = y;
    return this;
  }
  /** Writes the first number of vertex `i`. */
  setX(i: number, x: number) {
    this.array[i * this.itemSize] = x;
    return this;
  }
  /** A new attribute with a copy of the numbers. */
  clone() {
    return new BufferAttribute(this.array.slice() as BufferTypedArray, this.itemSize, this.type);
  }
}

/** Several attributes packed per vertex: `stride` numbers per vertex, each attribute at an offset. */
export class InterleavedBuffer {
  /** Always `true`: tells an interleaved buffer apart from anything else. */
  readonly isInterleavedBuffer = true as const;
  /** Every vertex's numbers, packed one after the other. */
  readonly array: Float32Array;
  /** How many numbers each vertex takes. */
  readonly stride: number;
  constructor(array: Float32Array, stride: number) {
    this.array = array;
    this.stride = stride;
  }
  /** How many vertices it packs. */
  get count() {
    return Math.floor(this.array.length / this.stride);
  }
  /** One attribute read out of the pack, as its own float attribute. */
  attribute(itemSize: number, offset: number) {
    const out = new Float32Array(this.count * itemSize);
    for (let v = 0; v < this.count; v++)
      for (let c = 0; c < itemSize; c++)
        out[v * itemSize + c] = this.array[v * this.stride + offset + c];
    return new BufferAttribute(out, itemSize, 'Float32Array');
  }
}

const make =
  <T extends BufferTypedArray>(Kind: { new (values: ArrayLike<number>): T }, type = Kind.name) =>
  (values: BufferNumbers, itemSize = 1) =>
    new BufferAttribute(
      values instanceof Kind ? values : new Kind(Array.from(values as ArrayLike<number>)),
      itemSize,
      type,
    );

/** The `buffer` family: an attribute of each numeric kind, and the interleaved pack. */
export const buffer = {
  /**
   * Per-vertex numbers kept as 32-bit decimals: positions, normals, UVs.
   * @param values - The numbers.
   * @param itemSize - Numbers per vertex.
   */
  float32: make(Float32Array),
  /**
   * Per-vertex numbers declared as 16-bit decimals.
   * @param values - The numbers.
   * @param itemSize - Numbers per vertex.
   */
  float16: make(Float32Array, 'Float16Array'),
  /**
   * Per-vertex whole numbers from 0 to about 4 billion: big triangle indices.
   * @param values - The numbers.
   * @param itemSize - Numbers per vertex.
   */
  uint32: make(Uint32Array),
  /**
   * Per-vertex whole numbers from 0 to 65,535: small triangle indices.
   * @param values - The numbers.
   * @param itemSize - Numbers per vertex.
   */
  uint16: make(Uint16Array),
  /**
   * Per-vertex whole numbers from 0 to 255: colours byte by byte.
   * @param values - The numbers.
   * @param itemSize - Numbers per vertex.
   */
  uint8: make(Uint8Array),
  /**
   * Per-vertex signed 32-bit whole numbers.
   * @param values - The numbers.
   * @param itemSize - Numbers per vertex.
   */
  int32: make(Int32Array),
  /**
   * Per-vertex signed 16-bit whole numbers.
   * @param values - The numbers.
   * @param itemSize - Numbers per vertex.
   */
  int16: make(Int16Array),
  /**
   * Per-vertex signed 8-bit whole numbers.
   * @param values - The numbers.
   * @param itemSize - Numbers per vertex.
   */
  int8: make(Int8Array),
  /**
   * Several attributes packed together, `stride` numbers per vertex.
   * @param array - Every vertex's numbers, packed.
   * @param stride - Numbers per vertex.
   */
  interleaved: (array: Float32Array, stride: number) => new InterleavedBuffer(array, stride),
};
