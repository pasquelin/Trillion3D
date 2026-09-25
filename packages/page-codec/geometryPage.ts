/**
 * Reference encoder for the `WGP3` quantized cluster page (`docs/FORMAT.md`). The compiler that
 * ships pages is the native one in `asset-compiler-rust`; this independent implementation exists
 * so the browser decoders in `sdk-browser/` are tested against something other than themselves.
 * It quantizes on the same grids — a primitive position exponent, a texture grid of 2^-14 (the
 * compiler's, coarser only where a caller passes a primitive's own), octahedral normal bytes,
 * colour bytes — and packs the same streams, without sharing a line.
 */
import { bitsFor, ceil32, octEncode, Packer, quantize, type QuantizedGrid } from './pageGrids.ts';
import {
  ATTRIBUTES,
  type PageAttribute,
  type PageAttributes,
  type PageCell,
} from './pageAttributes.ts';

const MAGIC = 0x33504757,
  VERSION = 3,
  HEADER_WORDS = 24,
  COLOR_EXPONENT = -8;
/** The format's texture grid, 2^-14: a quarter of a texel on a 4096-wide map. */
export const UV_EXPONENT = -14;

/**
 * Encodes one page from source indices and `{ array, itemSize }` attributes (`POSITION`
 * required). Returns the bytes and the manifest counts. Corners are renumbered by first use,
 * then vertices that land on the same cells are kept once. Texture coordinates sit on
 * `2 ** uvExponent`, which the header carries for every decoder.
 */
export function encodeGeometryPage(
  sourceIndices: ArrayLike<number>,
  attributes: PageAttributes,
  positionExponent = -16,
  uvExponent = UV_EXPONENT,
) {
  const position = attributes.POSITION;
  if (!position || position.itemSize !== 3 || !position.array.length)
    throw new Error('PAGE_POSITION_REQUIRED');
  if (sourceIndices.length < 3 || sourceIndices.length % 3)
    throw new Error('PAGE_TRIANGLES_INVALID');
  const count = position.array.length / 3,
    local = new Map<number, number>(),
    original: number[] = [];
  const corners = Array.from(sourceIndices, (source) => {
    if (!Number.isSafeInteger(source) || source < 0 || source >= count)
      throw new Error('PAGE_INDEX_INVALID');
    let id = local.get(source);
    if (id === undefined) {
      if (original.length >= 65535) throw new Error('PAGE_VERTEX_LIMIT');
      id = original.length;
      local.set(source, id);
      original.push(source);
    }
    return id;
  });
  let flags = 0;
  const gather = (attr: PageAttribute, width: number) => {
    const out = new Float32Array(original.length * width);
    original.forEach((source, i) => {
      for (let c = 0; c < width; c++) {
        const value = c < attr.itemSize ? attr.array[source * attr.itemSize + c] : 1;
        if (!Number.isFinite(value)) throw new Error('PAGE_ATTRIBUTE_NONFINITE');
        out[i * width + c] = value;
      }
    });
    return out;
  };
  const positions = quantize(gather(position, 3), 3, positionExponent);
  const cells: PageCell[] = original.map((_, i) => ({
    p: positions.cells.slice(i * 3, i * 3 + 3),
    n: 0,
    uv: [[], []],
    c: [],
  }));
  let error = 0;
  original.forEach((_, i) => {
    let d = 0;
    for (let c = 0; c < 3; c++)
      d +=
        (Math.fround(
          positions.min[c] + Math.fround(positions.cells[i * 3 + c] * 2 ** positions.exponent),
        ) -
          position.array[original[i] * 3 + c]) **
        2;
    error = Math.max(error, Math.sqrt(d));
  });
  error = ceil32(error);
  const uvRecords: [QuantizedGrid | null, QuantizedGrid | null] = [null, null];
  let colorRecord: QuantizedGrid | null = null;
  for (const [name, size, bit] of ATTRIBUTES) {
    const attr = attributes[name];
    if (!attr) continue;
    if (
      (attr.itemSize !== size && !(name === 'COLOR_0' && attr.itemSize === 3)) ||
      attr.array.length !== count * attr.itemSize
    )
      throw new Error('PAGE_ATTRIBUTE_INVALID: ' + name);
    flags |= bit;
    const values = gather(attr, size);
    if (bit === 1)
      cells.forEach(
        (cell, i) => (cell.n = octEncode(values[i * 3], values[i * 3 + 1], values[i * 3 + 2])),
      );
    else if (bit === 8) {
      const record = quantize(
        values.map((v) => Math.max(0, Math.min(1, v))),
        4,
        COLOR_EXPONENT,
      );
      colorRecord = record;
      cells.forEach((cell, i) => (cell.c = record.cells.slice(i * 4, i * 4 + 4)));
    } else {
      const set = bit === 2 ? 0 : 1,
        q = quantize(values, 2, uvExponent);
      uvRecords[set] = q;
      cells.forEach((cell, i) => (cell.uv[set] = q.cells.slice(i * 2, i * 2 + 2)));
    }
  }
  const unique: PageCell[] = [],
    rank = new Map<string, number>();
  const remap = cells.map((cell) => {
    const key = JSON.stringify(cell);
    let id = rank.get(key);
    if (id === undefined) {
      id = unique.push(cell) - 1;
      rank.set(key, id);
    }
    return id;
  });
  const pack = new Packer();
  pack.stream(
    corners.map((id) => remap[id]),
    bitsFor(unique.length - 1),
  );
  for (let c = 0; c < 3; c++)
    pack.stream(
      unique.map((cell) => cell.p[c]),
      positions.bits[c],
    );
  if (flags & 1)
    pack.stream(
      unique.map((cell) => cell.n),
      16,
    );
  for (const set of [0, 1] as const) {
    const record = uvRecords[set];
    if (record)
      for (let c = 0; c < 2; c++)
        pack.stream(
          unique.map((cell) => cell.uv[set][c]),
          record.bits[c],
        );
  }
  if (flags & 8) {
    const record = colorRecord;
    if (record)
      for (let c = 0; c < 4; c++)
        pack.stream(
          unique.map((cell) => cell.c[c]),
          record.bits[c],
        );
  }
  const data = new Uint8Array((HEADER_WORDS + pack.words.length) * 4),
    head = new DataView(data.buffer);
  const record = (at: number, q: QuantizedGrid | null, n: number, exponent: number) => {
    let word = ((q?.exponent ?? exponent) & 255) << 24;
    for (let c = 0; c < n; c++) word |= (q?.bits[c] ?? 0) << (6 * c);
    head.setUint32(at * 4, word >>> 0, true);
    for (let c = 0; c < n; c++) head.setFloat32((at + 1 + c) * 4, q?.min[c] ?? 0, true);
  };
  [MAGIC, VERSION, unique.length, corners.length, flags].forEach((word, i) =>
    head.setUint32(i * 4, word, true),
  );
  record(5, positions, 3, positionExponent);
  record(9, uvRecords[0], 2, uvExponent);
  record(12, uvRecords[1], 2, uvExponent);
  record(15, colorRecord, 4, COLOR_EXPONENT);
  head.setFloat32(80, error, true);
  pack.words.forEach((word, i) => head.setUint32((HEADER_WORDS + i) * 4, word, true));
  let floats = 3;
  for (const [, size, bit] of ATTRIBUTES) if (flags & bit) floats += size;
  return {
    data,
    vertexCount: unique.length,
    indexCount: corners.length,
    flags,
    uncompressedBytes: unique.length * floats * 4 + corners.length * 4,
    quantizationError: error,
  };
}
