/**
 * Reference encoder for the `WGP3` quantized cluster page (`docs/FORMAT.md`). The compiler that
 * ships pages is the native one in `asset-compiler-rust`; this independent implementation exists
 * so the browser decoders in `sdk-browser/` are tested against something other than themselves.
 * It quantizes on the same grids — a primitive position exponent, a fixed texture grid of 2^-14,
 * octahedral normal bytes, colour bytes — and packs the same streams, without sharing a line.
 */
import { bitsFor, octEncode, Packer, quantize } from './pageGrids.mjs';

const MAGIC = 0x33504757,
  VERSION = 3,
  HEADER_WORDS = 24,
  UV_EXPONENT = -14,
  COLOR_EXPONENT = -8;
/** Source attribute, presence bit and the field of the page cell it fills. */
const ATTRIBUTES = [
  ['NORMAL', 3, 1],
  ['TEXCOORD_0', 2, 2],
  ['TEXCOORD_1', 2, 4],
  ['COLOR_0', 4, 8],
];

/**
 * Encodes one page from source indices and `{ array, itemSize }` attributes (`POSITION`
 * required). Returns the bytes and the manifest counts. Corners are renumbered by first use,
 * then vertices that land on the same cells are kept once.
 */
export function encodeGeometryPage(sourceIndices, attributes, positionExponent = -16) {
  const position = attributes.POSITION;
  if (!position || position.itemSize !== 3 || !position.array.length)
    throw new Error('PAGE_POSITION_REQUIRED');
  if (sourceIndices.length < 3 || sourceIndices.length % 3)
    throw new Error('PAGE_TRIANGLES_INVALID');
  const count = position.array.length / 3,
    local = new Map(),
    original = [];
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
  const gather = (attr, width) => {
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
  const cells = original.map((_, i) => ({
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
  const uvRecords = [null, null];
  let colorRecord = null;
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
      colorRecord = quantize(
        values.map((v) => Math.max(0, Math.min(1, v))),
        4,
        COLOR_EXPONENT,
      );
      cells.forEach((cell, i) => (cell.c = colorRecord.cells.slice(i * 4, i * 4 + 4)));
    } else {
      const set = bit === 2 ? 0 : 1,
        q = quantize(values, 2, UV_EXPONENT);
      uvRecords[set] = q;
      cells.forEach((cell, i) => (cell.uv[set] = q.cells.slice(i * 2, i * 2 + 2)));
    }
  }
  const unique = [],
    rank = new Map();
  const remap = cells.map((cell) => {
    const key = JSON.stringify(cell);
    if (!rank.has(key)) rank.set(key, unique.push(cell) - 1);
    return rank.get(key);
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
  for (const set of [0, 1])
    if (uvRecords[set])
      for (let c = 0; c < 2; c++)
        pack.stream(
          unique.map((cell) => cell.uv[set][c]),
          uvRecords[set].bits[c],
        );
  if (flags & 8)
    for (let c = 0; c < 4; c++)
      pack.stream(
        unique.map((cell) => cell.c[c]),
        colorRecord.bits[c],
      );
  const data = new Uint8Array((HEADER_WORDS + pack.words.length) * 4),
    head = new DataView(data.buffer);
  const record = (at, q, n, exponent) => {
    let word = ((q?.exponent ?? exponent) & 255) << 24;
    for (let c = 0; c < n; c++) word |= (q?.bits[c] ?? 0) << (6 * c);
    head.setUint32(at * 4, word >>> 0, true);
    for (let c = 0; c < n; c++) head.setFloat32((at + 1 + c) * 4, q?.min[c] ?? 0, true);
  };
  [MAGIC, VERSION, unique.length, corners.length, flags].forEach((word, i) =>
    head.setUint32(i * 4, word, true),
  );
  record(5, positions, 3, positionExponent);
  record(9, uvRecords[0], 2, UV_EXPONENT);
  record(12, uvRecords[1], 2, UV_EXPONENT);
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
