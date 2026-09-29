import {
  FLAG_COLOR,
  FLAG_MORPH,
  FLAG_NORMAL,
  FLAG_SKIN,
  FLAG_UV,
  FLAG_UV1,
  BLOCK_CORNERS,
} from '../../cluster/format.ts';
import { blockRecord, field, readGeometryPageHeader, type Quant } from './geometryPageHeader.ts';
import { decodeMorphs, decodeSkin } from './geometryPageDeform.ts';
import { pageAttributeNames, pageViews } from './geometryPageBlock.ts';
import { octDecode } from '../../../../page-codec/pageGrids.ts';

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
  /** Morph targets: `attributes.morph` holds six floats of each per vertex; absent, none. */
  morphTargets?: number;
  /** Which attributes it carries. */
  flags: number;
  /** Its size once unpacked. */
  decodedBytes: number;
  /** The header's largest position displacement, in object units: a decoded position may lie
   *  that far from its source, and so from the page's declared box. */
  quantizationError: number;
};

const fround = Math.fround;

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
  const {
    vertexCount,
    indexCount,
    flags,
    quantizationError,
    position,
    uv,
    uv2,
    color,
    corners,
    positionCount,
    linkBits,
    skin,
    morphs,
    headerWords,
    bodyWords: at,
    decodedBytes,
    streams: {
      blocks,
      corners: cornerStream,
      positions,
      links,
      normal,
      uvs,
      uv2s,
      colors,
      skinned,
    },
  } = readGeometryPageHeader(data, maxDecodedBytes);
  // The streams are read in place when the page sits on a word boundary, from a copy otherwise.
  const body = data.subarray(headerWords * 4);
  const words =
    body.byteOffset % 4
      ? new Uint32Array(body.slice().buffer)
      : new Uint32Array(body.buffer, body.byteOffset, at);
  const { indices: decodedIndices, attributes } = pageViews(
    new ArrayBuffer(decodedBytes),
    pageAttributeNames(flags),
    vertexCount,
    morphs.length,
  );
  // Corners block by block (`CornerCode::read`), every record inside the stream (the header gate).
  for (let b = 0, i = 0; i < indexCount; b++) {
    const [base, width, start] = blockRecord(words, blocks, corners, b),
      end = Math.min(i + BLOCK_CORNERS, indexCount);
    for (let k = 0; i < end; i++, k++) {
      decodedIndices[i] = base + field(words, cornerStream * 32 + start + k * width, width);
      if (decodedIndices[i] >= vertexCount) throw new Error('GEOMETRY_PAGE_INDEX');
    }
  }
  if (positionCount < vertexCount) {
    // Positions stored once, each vertex dequantized from the one its link names (`positions.rs`).
    const step = 2 ** position.exponent;
    for (let i = 0; i < vertexCount; i++) {
      const p = field(words, links * 32 + i * linkBits, linkBits);
      for (let c = 0; c < 3; c++) {
        const q = field(words, positions[c] * 32 + p * position.bits[c], position.bits[c]);
        attributes.position[i * 3 + c] = fround(position.min[c] + fround(q * step));
      }
    }
  } else vector(attributes.position, words, positions, position);
  if (flags & FLAG_NORMAL)
    for (let i = 0; i < vertexCount; i++)
      octDecode(field(words, normal * 32 + i * 16, 16), attributes.normal, i * 3);
  if (flags & FLAG_UV) vector(attributes.uv, words, uvs, uv);
  if (flags & FLAG_UV1) vector(attributes.uv2, words, uv2s, uv2);
  if (flags & FLAG_COLOR) vector(attributes.color, words, colors, color);
  if (flags & FLAG_SKIN)
    decodeSkin(words, skinned, skin, attributes.skinIndex, attributes.skinWeight);
  if (flags & FLAG_MORPH) decodeMorphs(words, morphs, attributes.morph);
  return {
    indices: decodedIndices,
    attributes,
    vertexCount,
    morphTargets: morphs.length,
    flags,
    decodedBytes,
    quantizationError,
  };
}
