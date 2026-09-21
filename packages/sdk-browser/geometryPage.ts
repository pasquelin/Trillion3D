import { GEOMETRY_PAGE_FORMAT_VERSION } from '../sdk-core/index.ts';
import {
  CLUSTER_HEADER_WORDS,
  CLUSTER_PAGE_MAGIC,
  FLAGS_ALL,
  FLAG_COLOR,
  FLAG_NORMAL,
  FLAG_UV,
  FLAG_UV1,
  MAX_BITS,
  MAX_EXPONENT,
  OCT_SCALE,
  OPTIONAL,
} from './clusterFormat.ts';
import { pageAttributeNames, pageViews } from './geometryPageBlock.ts';

/**
 * JavaScript decoder of a `WGP3` quantized cluster page (`docs/FORMAT.md`), the mirror of the
 * shared Rust codec (`packages/page-codec-wasm`): same bytes, same refusals in the same order.
 * Every float is produced by the arithmetic the format prescribes — one multiply, one add, both
 * on 32-bit values — through `Math.fround`, so a position decoded here is the 32-bit float the
 * WebAssembly module and the WGSL routines decode.
 */
/** A decoded page: `indices` and every attribute are views on one buffer of `decodedBytes`
 *  (`geometryPageBlock.ts`). */
export type DecodedGeometryPage = {
  indices: Uint32Array<ArrayBuffer>;
  attributes: Record<string, Float32Array<ArrayBuffer>>;
  vertexCount: number;
  flags: number;
  decodedBytes: number;
  /** The header's largest position displacement, in object units: a decoded position may lie
   *  that far from its source, and so from the page's declared box. */
  quantizationError: number;
};

/** A vector attribute's grid: its minima, its power-of-two step and its per-component widths. */
type Quant = { min: number[]; exponent: number; bits: number[] };

const fround = Math.fround;
/** Bits that hold every value of `0..=range`; none for a constant field. */
export const bitsFor = (range: number) => (range <= 0 ? 0 : 32 - Math.clz32(range));

/** The `bits`-bit field at bit `at` of `words`; a field spans two words at most. */
function field(words: Uint32Array, at: number, bits: number) {
  if (!bits) return 0;
  const shift = at % 32,
    index = at >>> 5;
  let value = words[index] >>> shift;
  if (shift + bits > 32) value |= words[index + 1] << (32 - shift);
  return value & ((1 << bits) - 1);
}

/** A quantization record from its packed word (six bits per width, the exponent in the top byte). */
function record(word: number, min: number[]): Quant | null {
  const n = min.length,
    bits = Array.from({ length: n }, (_, c) => (word >>> (6 * c)) & 63),
    exponent = word >> 24;
  let repacked = (exponent & 255) << 24;
  for (let c = 0; c < n; c++) repacked |= bits[c] << (6 * c);
  const sane =
    Math.abs(exponent) <= MAX_EXPONENT &&
    bits.every((b) => b <= MAX_BITS) &&
    min.every(Number.isFinite) &&
    repacked >>> 0 === word;
  return sane ? { min, exponent, bits } : null;
}

/** Octahedral bytes (`x` low, `y` high) back to a unit vector, in 32-bit steps. */
function octDecode(q: number, out: Float32Array, at: number) {
  let x = fround(fround((q & 255) * OCT_SCALE) - 1),
    y = fround(fround(((q >>> 8) & 255) * OCT_SCALE) - 1);
  const z = fround(fround(1 - Math.abs(x)) - Math.abs(y));
  if (z < 0) {
    const fx = fround((1 - Math.abs(y)) * (x >= 0 ? 1 : -1)),
      fy = fround((1 - Math.abs(x)) * (y >= 0 ? 1 : -1));
    x = fx;
    y = fy;
  }
  const length = fround(Math.sqrt(fround(fround(fround(x * x) + fround(y * y)) + fround(z * z))));
  out[at] = fround(x / length);
  out[at + 1] = fround(y / length);
  out[at + 2] = fround(z / length);
}

/** One dequantized vector attribute into `out`: component `c` of vertex `i` at bit `i * bits[c]`
 *  of stream `c`. */
function vector(out: Float32Array, words: Uint32Array, starts: number[], quant: Quant) {
  const n = quant.min.length,
    step = 2 ** quant.exponent,
    count = out.length / n;
  for (let c = 0; c < n; c++) {
    const bits = quant.bits[c],
      base = starts[c] * 32,
      min = quant.min[c];
    for (let i = 0; i < count; i++)
      out[i * n + c] = fround(min + fround(field(words, base + i * bits, bits) * step));
  }
}

/** Decode one complete page without referring to any source glTF buffer. */
export function decodeGeometryPage(
  data: Uint8Array,
  maxDecodedBytes = 16 * 1024 * 1024,
): DecodedGeometryPage {
  if (data.byteLength < CLUSTER_HEADER_WORDS * 4) throw new Error('GEOMETRY_PAGE_HEADER');
  const head = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const w = (i: number) => head.getUint32(i * 4, true),
    f = (i: number) => head.getFloat32(i * 4, true);
  if (w(0) !== CLUSTER_PAGE_MAGIC || w(1) !== GEOMETRY_PAGE_FORMAT_VERSION)
    throw new Error('GEOMETRY_PAGE_VERSION');
  const vertexCount = w(2),
    indexCount = w(3),
    flags = w(4),
    position = record(w(5), [f(6), f(7), f(8)]),
    uv = record(w(9), [f(10), f(11)]),
    uv2 = record(w(12), [f(13), f(14)]),
    color = record(w(15), [f(16), f(17), f(18), f(19)]),
    quantizationError = f(20);
  if (!position || !uv || !uv2 || !color || w(21) || w(22) || w(23))
    throw new Error('GEOMETRY_PAGE_BOUNDS');
  // Word offset of each stream, derived from the counts and widths the header declares.
  const indexBits = bitsFor(vertexCount - 1);
  let at = 0;
  const stream = (present: boolean, count: number, bits: number) => {
    const start = at;
    if (present) at += Math.ceil((count * bits) / 32);
    return start;
  };
  const indices = stream(true, indexCount, indexBits),
    positions = position.bits.map((b) => stream(true, vertexCount, b)),
    normal = stream(!!(flags & FLAG_NORMAL), vertexCount, 16),
    uvs = uv.bits.map((b) => stream(!!(flags & FLAG_UV), vertexCount, b)),
    uv2s = uv2.bits.map((b) => stream(!!(flags & FLAG_UV1), vertexCount, b)),
    colors = color.bits.map((b) => stream(!!(flags & FLAG_COLOR), vertexCount, b));
  let floats = 3;
  for (const [, size, bit] of OPTIONAL) if (flags & bit) floats += size;
  const decodedBytes = vertexCount * floats * 4 + indexCount * 4;
  if (
    !vertexCount ||
    vertexCount > 65535 ||
    indexCount < 3 ||
    indexCount % 3 ||
    flags & ~FLAGS_ALL ||
    !(quantizationError >= 0) ||
    !Number.isFinite(quantizationError) ||
    decodedBytes > maxDecodedBytes ||
    (CLUSTER_HEADER_WORDS + at) * 4 !== data.byteLength
  )
    throw new Error('GEOMETRY_PAGE_BOUNDS');
  // The streams are read in place when the page sits on a word boundary, from a copy otherwise.
  const body = data.subarray(CLUSTER_HEADER_WORDS * 4);
  const words =
    body.byteOffset % 4
      ? new Uint32Array(body.slice().buffer)
      : new Uint32Array(body.buffer, body.byteOffset, at);
  const { indices: decodedIndices, attributes } = pageViews(
    new ArrayBuffer(decodedBytes),
    pageAttributeNames(flags),
    vertexCount,
  );
  for (let i = 0; i < indexCount; i++) {
    decodedIndices[i] = field(words, indices * 32 + i * indexBits, indexBits);
    if (decodedIndices[i] >= vertexCount) throw new Error('GEOMETRY_PAGE_INDEX');
  }
  vector(attributes.position, words, positions, position);
  if (flags & FLAG_NORMAL)
    for (let i = 0; i < vertexCount; i++)
      octDecode(field(words, normal * 32 + i * 16, 16), attributes.normal, i * 3);
  if (flags & FLAG_UV) vector(attributes.uv, words, uvs, uv);
  if (flags & FLAG_UV1) vector(attributes.uv2, words, uv2s, uv2);
  if (flags & FLAG_COLOR) vector(attributes.color, words, colors, color);
  return { indices: decodedIndices, attributes, vertexCount, flags, decodedBytes, quantizationError };
}
