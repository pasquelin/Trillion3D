import {
  CLUSTER_HEADER_WORDS,
  CLUSTER_PAGE_MAGIC,
  CLUSTER_PAGE_VERSION,
  FLAGS_ALL,
  FLAG_COLOR,
  FLAG_NORMAL,
  FLAG_UV,
  FLAG_UV1,
  MAX_BITS,
  MAX_EXPONENT,
  OCT_SCALE,
} from './clusterFormat.ts';

/**
 * JavaScript decoder of a `WGP3` quantized cluster page (`docs/FORMAT.md`), the mirror of the
 * shared Rust codec (`packages/page-codec-wasm`): same buffers, same refusals in the same order.
 * Every float is produced by the arithmetic the format prescribes — one multiply, one add, both
 * on 32-bit values — through `Math.fround`, so a position decoded here is the 32-bit float the
 * WebAssembly module and the WGSL routines decode.
 */
/** Presence bit, decoded width and name of each optional attribute, in stream order. */
const OPTIONAL = [
  ['normal', 3, FLAG_NORMAL],
  ['uv', 2, FLAG_UV],
  ['uv2', 2, FLAG_UV1],
  ['color', 4, FLAG_COLOR],
] as const;

export type DecodedGeometryPage = {
  indices: Uint32Array;
  attributes: Record<string, Float32Array>;
  vertexCount: number;
  flags: number;
  decodedBytes: number;
};

/** A vector attribute's grid: its minima, its power-of-two step and its per-component widths. */
type Quant = { min: number[]; exponent: number; bits: number[] };

const fround = Math.fround;
const bitsFor = (range: number) => (range <= 0 ? 0 : Math.floor(Math.log2(range)) + 1);
const streamWords = (count: number, bits: number) => Math.ceil((count * bits) / 32);

/** The `bits`-bit field at bit `at` of `words`; a field spans two words at most. */
function field(words: Uint32Array, at: number, bits: number) {
  if (!bits) return 0;
  const shift = at % 32,
    index = at >>> 5;
  let value = words[index] >>> shift;
  if (shift + bits > 32) value |= words[index + 1] << (32 - shift);
  return bits === 32 ? value >>> 0 : value & ((1 << bits) - 1);
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

/** One dequantized vector attribute: component `c` of vertex `i` at bit `i * bits[c]` of stream `c`. */
function vector(words: Uint32Array, starts: number[], quant: Quant, count: number) {
  const n = quant.min.length,
    step = 2 ** quant.exponent,
    out = new Float32Array(count * n);
  for (let c = 0; c < n; c++) {
    const bits = quant.bits[c],
      base = starts[c] * 32,
      min = quant.min[c];
    for (let i = 0; i < count; i++)
      out[i * n + c] = fround(min + fround(field(words, base + i * bits, bits) * step));
  }
  return out;
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
  if (w(0) !== CLUSTER_PAGE_MAGIC || w(1) !== CLUSTER_PAGE_VERSION)
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
    if (present) at += streamWords(count, bits);
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
  const words = new Uint32Array(at);
  for (let i = 0; i < at; i++) words[i] = w(CLUSTER_HEADER_WORDS + i);
  const decodedIndices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    decodedIndices[i] = field(words, indices * 32 + i * indexBits, indexBits);
    if (decodedIndices[i] >= vertexCount) throw new Error('GEOMETRY_PAGE_INDEX');
  }
  const attributes: Record<string, Float32Array> = {
    position: vector(words, positions, position, vertexCount),
  };
  if (flags & FLAG_NORMAL) {
    attributes.normal = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++)
      octDecode(field(words, normal * 32 + i * 16, 16), attributes.normal, i * 3);
  }
  if (flags & FLAG_UV) attributes.uv = vector(words, uvs, uv, vertexCount);
  if (flags & FLAG_UV1) attributes.uv2 = vector(words, uv2s, uv2, vertexCount);
  if (flags & FLAG_COLOR) attributes.color = vector(words, colors, color, vertexCount);
  return { indices: decodedIndices, attributes, vertexCount, flags, decodedBytes };
}
