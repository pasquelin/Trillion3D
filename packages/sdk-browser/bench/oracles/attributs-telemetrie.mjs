// Pure A13 and A14 oracles, no side effects: `chargement.bench.mjs` measures them; unit
// tests import them as reference.
const OPTIONAL = [
  ['normal', 3, 1],
  ['uv', 2, 2],
  ['tangent', 4, 4],
  ['uv2', 2, 8],
  ['color', 4, 16],
];

/** `geometryPage.ts:63-88` before batch A: `DataView` element by element, a closure per vertex. */
export function referenceDecode(indexData, vertexData, indexCount, vertexCount, flags, stride) {
  const indexView = new DataView(indexData.buffer),
    indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    indices[i] = indexView.getUint16(i * 2, true);
    if (indices[i] >= vertexCount) throw new Error('GEOMETRY_PAGE_INDEX');
  }
  const attributes = { position: new Float32Array(vertexCount * 3) };
  for (const [name, size, bit] of OPTIONAL)
    if (flags & bit) attributes[name] = new Float32Array(vertexCount * size);
  const vertices = new DataView(vertexData.buffer);
  for (let i = 0; i < vertexCount; i++) {
    let offset = i * stride;
    const read = (name, size) => {
      const target = attributes[name];
      for (let c = 0; c < size; c++) {
        const value = vertices.getFloat32(offset, true);
        if (!Number.isFinite(value)) throw new Error('GEOMETRY_PAGE_NONFINITE');
        target[i * size + c] = value;
        offset += 4;
      }
    };
    read('position', 3);
    for (const [name, size, bit] of OPTIONAL)
      if (flags & bit) read(name, size);
      else offset += size * 4;
  }
  return { indices, attributes };
}

/** `telemetry.ts:24-33` before batch A: `push` then `shift` of the whole array. */
export function referenceIntervals(max, valeurs) {
  const intervals = [];
  for (const dt of valeurs)
    if (dt > 0 && dt < 1000) {
      intervals.push(dt);
      if (intervals.length > max) intervals.shift();
    }
  return intervals;
}

/** `clusterPages.ts:12-15` and `streamingFetch.ts:4-7` before batch A: one `toString` per byte. */
export const referenceHex = (digested) =>
  Array.from(digested, (b) => b.toString(16).padStart(2, '0')).join('');
