import type { PageAttribute } from '../../../page-codec/pageAttributes.ts';
/** Numbers a buffer is written from. */
export type BufferNumbers = ArrayLike<number> | ArrayBufferView;
/** The typed arrays a buffer holds. */
export type BufferTypedArray =
  Float64Array | Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array;

/** A typed array of per-vertex values, `itemSize` numbers per vertex: the page codec's
 *  `PageAttribute` (`page-codec/pageAttributes.ts`), with what a page writes into it. */
export class BufferAttribute implements PageAttribute {
  readonly isBufferAttribute = true as const;
  /** How the values were declared; a half-float attribute is held at float precision. */
  readonly type: string;
  normalized = false;
  /** Bumped by every declared write: what the world compares to see the content changed. */
  version = 0;
  /** Called when the attribute is declared written; set by the geometry that holds it. */
  _onChange: (() => void) | null = null;

  readonly array: BufferTypedArray;
  readonly itemSize: number;
  constructor(array: BufferTypedArray, itemSize: number, type = array.constructor.name) {
    this.array = array;
    this.itemSize = itemSize;
    this.type = type;
  }
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
  getComponent(index: number, component: number) {
    return this.array[index * this.itemSize + component];
  }
  getX(i: number) {
    return this.getComponent(i, 0);
  }
  getY(i: number) {
    return this.getComponent(i, 1);
  }
  getZ(i: number) {
    return this.getComponent(i, 2);
  }
  getW(i: number) {
    return this.getComponent(i, 3);
  }
  setXYZ(i: number, x: number, y: number, z: number) {
    const at = i * this.itemSize;
    this.array[at] = x;
    this.array[at + 1] = y;
    this.array[at + 2] = z;
    return this;
  }
  setXY(i: number, x: number, y: number) {
    this.array[i * this.itemSize] = x;
    this.array[i * this.itemSize + 1] = y;
    return this;
  }
  setX(i: number, x: number) {
    this.array[i * this.itemSize] = x;
    return this;
  }
  clone() {
    return new BufferAttribute(this.array.slice() as BufferTypedArray, this.itemSize, this.type);
  }
}

/** Several attributes packed per vertex: `stride` numbers per vertex, each attribute at an offset. */
export class InterleavedBuffer {
  readonly isInterleavedBuffer = true as const;
  readonly array: Float32Array;
  readonly stride: number;
  constructor(array: Float32Array, stride: number) {
    this.array = array;
    this.stride = stride;
  }
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
  float32: make(Float32Array),
  float16: make(Float32Array, 'Float16Array'),
  uint32: make(Uint32Array),
  uint16: make(Uint16Array),
  uint8: make(Uint8Array),
  int32: make(Int32Array),
  int16: make(Int16Array),
  int8: make(Int8Array),
  interleaved: (array: Float32Array, stride: number) => new InterleavedBuffer(array, stride),
};
