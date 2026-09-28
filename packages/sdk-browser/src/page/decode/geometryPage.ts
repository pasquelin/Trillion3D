import {
  CLUSTER_HEADER_WORDS,
  FLAG_COLOR,
  FLAG_NORMAL,
  FLAG_UV,
  FLAG_UV1,
  BLOCK_CORNERS,
  OCT_SCALE,
} from '../../cluster/format.ts';
import {
  blockRecord,
  field,
  readGeometryPageHeader,
  type GeometryPageHeader,
  type Quant,
} from './geometryPageHeader.ts';
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
  /** The triangle indices. */
  indices: Uint32Array<ArrayBuffer>;
  /** The vertex lists by name. */
  attributes: Record<string, Float32Array<ArrayBuffer>>;
  /** Vertices. */
  vertexCount: number;
  /** Which attributes it carries. */
  flags: number;
  /** Its size once unpacked. */
  decodedBytes: number;
  /** The header's largest position displacement, in object units: a decoded position may lie
   *  that far from its source, and so from the page's declared box. */
  quantizationError: number;
};

const fround = Math.fround;
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

/** Every corner into `out`, block by block (`docs/FORMAT.md`, the mirror of `CornerCode::read`),
 *  the records already inside the corner stream (`readGeometryPageHeader`): a record's base, then
 *  each corner's distance to it. A corner past the vertices refuses the page. */
function decodeCorners(
  words: Uint32Array,
  corners: GeometryPageHeader['corners'],
  [table, stream]: number[],
  vertexCount: number,
  out: Uint32Array,
) {
  for (let b = 0, i = 0; i < out.length; b++) {
    const [base, width, start] = blockRecord(words, table, corners, b),
      end = Math.min(i + BLOCK_CORNERS, out.length);
    for (let k = 0; i < end; i++, k++) {
      out[i] = base + field(words, stream * 32 + start + k * width, width);
      if (out[i] >= vertexCount) throw new Error('GEOMETRY_PAGE_INDEX');
    }
  }
}

/** Decode one complete page without referring to any source glTF buffer. */
export function decodeGeometryPage(
  data: Uint8Array,
  maxDecodedBytes = 16 * 1024 * 1024,
): DecodedGeometryPage {
  const {
    vertexCount,
    flags,
    quantizationError,
    position,
    uv,
    uv2,
    color,
    corners,
    bodyWords: at,
    decodedBytes,
    streams: { blocks, corners: cornerStream, positions, normal, uvs, uv2s, colors },
  } = readGeometryPageHeader(data, maxDecodedBytes);
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
  decodeCorners(words, corners, [blocks, cornerStream], vertexCount, decodedIndices);
  vector(attributes.position, words, positions, position);
  if (flags & FLAG_NORMAL)
    for (let i = 0; i < vertexCount; i++)
      octDecode(field(words, normal * 32 + i * 16, 16), attributes.normal, i * 3);
  if (flags & FLAG_UV) vector(attributes.uv, words, uvs, uv);
  if (flags & FLAG_UV1) vector(attributes.uv2, words, uv2s, uv2);
  if (flags & FLAG_COLOR) vector(attributes.color, words, colors, color);
  return {
    indices: decodedIndices,
    attributes,
    vertexCount,
    flags,
    decodedBytes,
    quantizationError,
  };
}
