import * as meshoptimizer from 'meshoptimizer';

const MAGIC = 0x32504757,
  VERSION = 2;
const OPTIONAL = [
  ['normal', 3, 1],
  ['uv', 2, 2],
  ['tangent', 4, 4],
  ['uv2', 2, 8],
  ['color', 4, 16],
] as const;

/** Typed views are only read in native endianness; elsewhere `DataView` remains the path. */
const PETIT_BOUTIEN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export type DecodedGeometryPage = {
  indices: Uint32Array;
  attributes: Record<string, Float32Array>;
  vertexCount: number;
  flags: number;
  decodedBytes: number;
};

/**
 * Indices and attributes of a page, from the buffers meshopt has just decompressed.
 *
 * The read plan — each present attribute, its width, its offset in floats within the vertex — is
 * the same for the 65,535 vertices of a page: it is computed once, and not rebuilt with a closure
 * at every vertex. Sixteen-bit indices and floats are read by typed view when the machine is
 * little-endian, by `DataView` otherwise: same values, same refusals.
 */
export function decodePageAttributes(
  indexData: Uint8Array,
  vertexData: Uint8Array,
  indexCount: number,
  vertexCount: number,
  flags: number,
  stride: number,
) {
  const indices = new Uint32Array(indexCount);
  if (PETIT_BOUTIEN) indices.set(new Uint16Array(indexData.buffer, 0, indexCount));
  else {
    const indexView = new DataView(indexData.buffer);
    for (let i = 0; i < indexCount; i++) indices[i] = indexView.getUint16(i * 2, true);
  }
  for (let i = 0; i < indexCount; i++)
    if (indices[i] >= vertexCount) throw new Error('GEOMETRY_PAGE_INDEX');
  const attributes: Record<string, Float32Array> = { position: new Float32Array(vertexCount * 3) };
  for (const [name, size, bit] of OPTIONAL)
    if (flags & bit) attributes[name] = new Float32Array(vertexCount * size);
  const plan: Array<[Float32Array, number, number]> = [[attributes.position, 3, 0]];
  let place = 3;
  for (const [name, size, bit] of OPTIONAL) {
    if (flags & bit) plan.push([attributes[name], size, place]);
    place += size;
  }
  const floats = PETIT_BOUTIEN ? new Float32Array(vertexData.buffer) : null,
    vertices = PETIT_BOUTIEN ? null : new DataView(vertexData.buffer);
  const parSommet = stride / 4;
  for (let i = 0; i < vertexCount; i++) {
    const base = i * parSommet;
    for (let a = 0; a < plan.length; a++) {
      const target = plan[a][0],
        size = plan[a][1],
        at = base + plan[a][2];
      for (let c = 0; c < size; c++) {
        const value = floats ? floats[at + c] : vertices!.getFloat32((at + c) * 4, true);
        if (!Number.isFinite(value)) throw new Error('GEOMETRY_PAGE_NONFINITE');
        target[i * size + c] = value;
      }
    }
  }
  return { indices, attributes };
}

/** Decode one complete meshopt page without referring to any source glTF buffer. */
export async function decodeGeometryPage(
  data: Uint8Array,
  maxDecodedBytes = 16 * 1024 * 1024,
): Promise<DecodedGeometryPage> {
  if (data.byteLength < 32) throw new Error('GEOMETRY_PAGE_HEADER');
  const head = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (head.getUint32(0, true) !== MAGIC || head.getUint32(4, true) !== VERSION)
    throw new Error('GEOMETRY_PAGE_VERSION');
  const vertexCount = head.getUint32(8, true),
    indexCount = head.getUint32(12, true),
    flags = head.getUint32(16, true),
    stride = head.getUint32(20, true),
    indexBytes = head.getUint32(24, true),
    vertexBytes = head.getUint32(28, true);
  const decodedBytes = vertexCount * stride + indexCount * 2;
  if (
    !vertexCount ||
    vertexCount > 65535 ||
    !indexCount ||
    indexCount % 3 ||
    flags & ~31 ||
    stride !== 72 ||
    decodedBytes > maxDecodedBytes ||
    32 + indexBytes + vertexBytes !== data.byteLength
  )
    throw new Error('GEOMETRY_PAGE_BOUNDS');
  await meshoptimizer.MeshoptDecoder.ready;
  const indexData = new Uint8Array(indexCount * 2),
    vertexData = new Uint8Array(vertexCount * stride);
  meshoptimizer.MeshoptDecoder.decodeIndexBuffer(
    indexData,
    indexCount,
    2,
    data.subarray(32, 32 + indexBytes),
  );
  meshoptimizer.MeshoptDecoder.decodeVertexBuffer(
    vertexData,
    vertexCount,
    stride,
    data.subarray(32 + indexBytes),
  );
  const { indices, attributes } = decodePageAttributes(
    indexData,
    vertexData,
    indexCount,
    vertexCount,
    flags,
    stride,
  );
  return { indices, attributes, vertexCount, flags, decodedBytes };
}
