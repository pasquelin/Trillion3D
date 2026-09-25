/**
 * The vertex attributes: one owning its storage, one viewing a slice of an interleaved buffer, and
 * the interleaved buffer itself. A reader uploads an attribute's bytes as they are and compares
 * `version` (the buffer's, for a view) to know they changed.
 */
import type { PageAttribute } from '../../../../page-codec/pageAttributes.ts';
import { VertexElements, type BufferTypedArray } from './elements.ts';

export type { BufferTypedArray } from './elements.ts';

/** A copy of `source`'s numbers into an attribute owning them: every vertex, or those `order`
 *  lists, in `source`'s type and normalisation. */
export function ownAttribute(source: VertexAttribute, order?: ArrayLike<number>) {
  const count = order ? order.length : source.count,
    size = source.itemSize;
  const array = new (source.array.constructor as new (length: number) => BufferTypedArray)(
    count * size,
  );
  for (let i = 0; i < count; i++)
    for (let c = 0; c < size; c++) array[i * size + c] = source.stored(order ? order[i] : i, c);
  const copy = new BufferAttribute(array, size, source.normalized);
  copy.name = source.name;
  return copy;
}

/** A typed array of per-vertex values, `itemSize` numbers per vertex: the page codec's
 *  `PageAttribute` (`page-codec/pageAttributes.ts`), with what a page writes into it. */
export class BufferAttribute extends VertexElements implements PageAttribute {
  /** Always `true`: tells a buffer attribute apart from anything else. */
  readonly isBufferAttribute = true as const;
  /** The attribute owns its buffer. */
  readonly kind = 'attribute' as const;
  /** How the values were declared; a half-float attribute is held at float precision. */
  readonly type: string;
  /** Bumped by every declared write: what the world compares to see the content changed. */
  version = 0;
  /** Called when the attribute is declared written; set by the geometry that holds it. */
  _onChange: (() => void) | null = null;
  /** Ranges of `array` written since the last upload, sent alone. */
  readonly updateRanges: { start: number; count: number }[] = [];
  /** The numbers themselves. */
  readonly array: BufferTypedArray;
  constructor(
    array: BufferTypedArray,
    itemSize: number,
    normalized = false,
    type = array.constructor.name,
  ) {
    super(itemSize, normalized);
    this.array = array;
    this.type = type;
  }
  /** How many vertices the numbers describe. */
  get count() {
    return Math.floor(this.array.length / this.itemSize);
  }
  protected at(index: number) {
    return index * this.itemSize;
  }
  /** `needsUpdate = true` after writing `array`: a reader uploads it again. */
  set needsUpdate(value: boolean) {
    if (!value) return;
    this.version++;
    this._onChange?.();
  }
  get needsUpdate() {
    return false;
  }
  /** Marks `count` numbers from `start` written. */
  addUpdateRange(start: number, count: number) {
    this.updateRanges.push({ start, count });
  }
  /** Forgets the written ranges, once uploaded. */
  clearUpdateRanges() {
    this.updateRanges.length = 0;
  }
  /** A new attribute with a copy of the numbers, their type, normalisation and name. */
  clone() {
    const copy = new BufferAttribute(this.array.slice(), this.itemSize, this.normalized, this.type);
    copy.name = this.name;
    return copy;
  }
}

/** Several attributes packed per vertex: `stride` numbers per vertex, each attribute at an offset. */
export class InterleavedBuffer {
  /** Always `true`: tells an interleaved buffer apart from anything else. */
  readonly isInterleavedBuffer = true as const;
  /** One storage several attributes view. */
  readonly kind = 'interleavedBuffer' as const;
  /** Bumped by `needsUpdate`. */
  version = 0;
  /** Every vertex's numbers, packed one after the other. */
  readonly array: BufferTypedArray;
  /** How many numbers each vertex takes. */
  readonly stride: number;
  constructor(array: BufferTypedArray, stride: number) {
    this.array = array;
    this.stride = stride;
  }
  /** How many vertices it packs. */
  get count() {
    return Math.floor(this.array.length / this.stride);
  }
  /** `needsUpdate = true` after writing `array`: a reader uploads it again. */
  set needsUpdate(value: boolean) {
    if (value) this.version++;
  }
  get needsUpdate() {
    return false;
  }
  /** One attribute read out of the pack, as its own attribute. */
  attribute(itemSize: number, offset: number) {
    return new InterleavedBufferAttribute(this, itemSize, offset).clone();
  }
}

/** An attribute viewing `itemSize` numbers at `offset` of each vertex of an interleaved buffer. */
export class InterleavedBufferAttribute extends VertexElements {
  /** Always `true`: tells an interleaved view apart from anything else. */
  readonly isInterleavedBufferAttribute = true as const;
  /** The attribute views a shared buffer. */
  readonly kind = 'interleavedAttribute' as const;
  /** The buffer it views. */
  readonly data: InterleavedBuffer;
  /** Where its numbers start in each vertex. */
  readonly offset: number;
  constructor(data: InterleavedBuffer, itemSize: number, offset: number, normalized = false) {
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
  /** `needsUpdate = true` after writing `array`: a reader uploads it again. */
  set needsUpdate(value: boolean) {
    this.data.needsUpdate = value;
  }
  get needsUpdate() {
    return false;
  }
  /** Its own numbers, copied out of the pack into an attribute owning them. */
  clone() {
    return ownAttribute(this);
  }
}

/** Either kind of attribute: owning its storage or viewing an interleaved one. */
export type VertexAttribute = BufferAttribute | InterleavedBufferAttribute;
