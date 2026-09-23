import { GEOMETRY_PAGE_FORMAT_VERSION } from '../../../../sdk-core/src/index.ts';
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
  OPTIONAL,
} from '../../cluster/format.ts';

/** A vector attribute's grid: its minima, its power-of-two step and its per-component widths. */
export type Quant = { min: number[]; exponent: number; bits: number[] };

/** Bits that hold every value of `0..=range`; none for a constant field. */
const bitsFor = (range: number) => (range <= 0 ? 0 : 32 - Math.clz32(range));

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

/**
 * The 24-word header of a `WGP3` page, read and checked: magic, format version, the four
 * quantization grids, and counts that agree with the page's own byte length — the stream layout is
 * derived from the counts and widths the header declares, so a page whose body does not measure
 * exactly what its header describes is refused here rather than read out of bounds.
 *
 * This is the one gate of the format on this side. The full decode goes through it, and so does
 * every reader that only admits the bytes — the WebGPU pool, which uploads the page words in place
 * and never decodes them on the CPU — so both refuse the same bytes for the same reason.
 */
export function readGeometryPageHeader(data: Uint8Array, maxDecodedBytes = 16 * 1024 * 1024) {
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
  return {
    vertexCount,
    indexCount,
    flags,
    quantizationError,
    position,
    uv,
    uv2,
    color,
    indexBits,
    bodyWords: at,
    decodedBytes,
    streams: { indices, positions, normal, uvs, uv2s, colors },
  };
}
