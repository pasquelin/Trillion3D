import { BufferAttribute, InterleavedBuffer } from './attribute.ts';
import type { BufferTypedArray } from './elements.ts';

export {
  BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  type VertexAttribute,
} from './attribute.ts';
export { VertexElements, type BufferTypedArray } from './elements.ts';

/** Numbers a buffer is written from. */
export type BufferNumbers = ArrayLike<number> | ArrayBufferView;

const make =
  <T extends BufferTypedArray>(Kind: { new (values: ArrayLike<number>): T }, type = Kind.name) =>
  (values: BufferNumbers, itemSize = 1) =>
    new BufferAttribute(
      values instanceof Kind ? values : new Kind(Array.from(values as ArrayLike<number>)),
      itemSize,
      false,
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
