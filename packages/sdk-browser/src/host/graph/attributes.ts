/**
 * THE VERTEX ATTRIBUTES OF THE ENGINE'S OWN GRAPH: owning their storage, or viewing one slice of
 * an interleaved buffer. The shape is the one the engine reads (`../resources.ts`); the rule is the
 * reference's, number for number: an integer attribute declared normalised reads as its value
 * over the largest of its type.
 */
/** The typed arrays an attribute holds. */
export type GraphArray =
  Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array;

/** The largest value of each integer type: what a normalised element is read over. */
const SCALES = new Map<unknown, [scale: number, signed: boolean]>([
  [Uint32Array, [4294967295.0, false]],
  [Uint16Array, [65535.0, false]],
  [Uint8Array, [255.0, false]],
  [Int32Array, [2147483647.0, true]],
  [Int16Array, [32767.0, true]],
  [Int8Array, [127.0, true]],
]);

/** A stored element read as the number it stands for. */
function denormalize(value: number, array: GraphArray) {
  const scale = SCALES.get(array.constructor);
  if (!scale) return value;
  return scale[1] ? Math.max(value / scale[0], -1) : value / scale[0];
}

/** A number written as the element that stands for it. */
function normalize(value: number, array: GraphArray) {
  const scale = SCALES.get(array.constructor);
  return scale ? Math.round(value * scale[0]) : value;
}

/** Bumps a version: what a reader compares to know the content changed. */
type Versioned = { version: number };

/** The elements of one attribute, read and written by component. */
abstract class Elements {
  /** The name a morph target is known by; empty for the others. */
  name = '';
  /** Numbers per vertex. */
  readonly itemSize: number;
  /** Whether integers read as 0 to 1. */
  normalized: boolean;
  constructor(itemSize: number, normalized: boolean) {
    this.itemSize = itemSize;
    this.normalized = normalized;
  }
  /** The storage the elements live in. */
  abstract get array(): GraphArray;
  /** How many vertices. */
  abstract get count(): number;
  /** Where component 0 of vertex `index` lies in `array`. */
  protected abstract at(index: number): number;
  /** Component `component` of vertex `index`, read as the number it stands for. */
  getComponent(index: number, component: number) {
    const value = this.array[this.at(index) + component];
    return this.normalized ? denormalize(value, this.array) : value;
  }
  /** Writes component `component` of vertex `index`. */
  setComponent(index: number, component: number, value: number) {
    this.array[this.at(index) + component] = this.normalized ? normalize(value, this.array) : value;
    return this;
  }
  /** The first number of vertex `index`. */
  getX(index: number) {
    return this.getComponent(index, 0);
  }
  /** The second number of vertex `index`. */
  getY(index: number) {
    return this.getComponent(index, 1);
  }
  /** The third number of vertex `index`. */
  getZ(index: number) {
    return this.getComponent(index, 2);
  }
  /** The fourth number of vertex `index`. */
  getW(index: number) {
    return this.getComponent(index, 3);
  }
  /** Writes the first number of vertex `index`. */
  setX(index: number, value: number) {
    return this.setComponent(index, 0, value);
  }
  /** Writes the second number of vertex `index`. */
  setY(index: number, value: number) {
    return this.setComponent(index, 1, value);
  }
  /** Writes the third number of vertex `index`. */
  setZ(index: number, value: number) {
    return this.setComponent(index, 2, value);
  }
  /** Writes the fourth number of vertex `index`. */
  setW(index: number, value: number) {
    return this.setComponent(index, 3, value);
  }
}

/** An attribute owning its storage: `itemSize` numbers per vertex, one after the other. */
export class GraphAttribute extends Elements implements Versioned {
  /** Always `true`: the attribute owns its buffer. */
  readonly isBufferAttribute = true as const;
  /** How many vertices; fixed at construction, as the storage is. */
  readonly count: number;
  /** Bumped by `needsUpdate`. */
  version = 0;
  /** The storage. */
  readonly array: GraphArray;
  /** Ranges of `array` written since the last upload, sent alone. */
  readonly updateRanges: { start: number; count: number }[] = [];
  constructor(array: GraphArray, itemSize: number, normalized = false) {
    super(itemSize, normalized);
    this.array = array;
    this.count = array.length / itemSize;
  }
  protected at(index: number) {
    return index * this.itemSize;
  }
  /** Marks `count` numbers from `start` written. */
  addUpdateRange(start: number, count: number) {
    this.updateRanges.push({ start, count });
  }
  /** Forgets the written ranges, once uploaded. */
  clearUpdateRanges() {
    this.updateRanges.length = 0;
  }
  /** `needsUpdate = true` after writing `array`: a reader uploads it again. */
  set needsUpdate(value: boolean) {
    if (value) this.version++;
  }
  get needsUpdate() {
    return false;
  }
}

/** One storage several attributes view, a vertex every `stride` numbers. */
export class GraphInterleavedBuffer implements Versioned {
  /** Always `true`: tells an interleaved buffer apart. */
  readonly isInterleavedBuffer = true as const;
  /** How many vertices. */
  readonly count: number;
  /** Bumped by `needsUpdate`. */
  version = 0;
  /** The storage. */
  readonly array: GraphArray;
  /** Numbers per vertex. */
  readonly stride: number;
  constructor(array: GraphArray, stride: number) {
    this.array = array;
    this.stride = stride;
    this.count = array.length / stride;
  }
  set needsUpdate(value: boolean) {
    if (value) this.version++;
  }
  get needsUpdate() {
    return false;
  }
}

/** An attribute viewing `itemSize` numbers at `offset` of each vertex of an interleaved buffer. */
export class GraphInterleavedAttribute extends Elements {
  /** Always `true`: the attribute views a shared buffer. */
  readonly isInterleavedBufferAttribute = true as const;
  /** The buffer it views. */
  readonly data: GraphInterleavedBuffer;
  /** Where its numbers start in each vertex. */
  readonly offset: number;
  constructor(data: GraphInterleavedBuffer, itemSize: number, offset: number, normalized = false) {
    super(itemSize, normalized);
    this.data = data;
    this.offset = offset;
  }
  get array() {
    return this.data.array;
  }
  get count() {
    return this.data.count;
  }
  protected at(index: number) {
    return index * this.data.stride + this.offset;
  }
  set needsUpdate(value: boolean) {
    this.data.needsUpdate = value;
  }
  get needsUpdate() {
    return false;
  }
}

/** Either kind of attribute. */
export type GraphElements = GraphAttribute | GraphInterleavedAttribute;
