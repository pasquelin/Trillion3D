// The JavaScript decoder of a quantized cluster page against the reference encoder of
// `packages/page-codec`: triangles identical, every attribute within the grid's declared error,
// vertices on the same cells kept once, and the refusals of the format in their order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGeometryPage } from './geometryPage.ts';
import { encodeGeometryPage } from '../page-codec/geometryPage.mjs';

/** A fan of `triangles` triangles around vertex 0, positions on a small grid, every attribute. */
function page(triangles: number, exponent = -10) {
  const count = triangles + 2;
  const position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3),
    uv = new Float32Array(count * 2),
    color = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    position.set([Math.cos(angle) * 3.7, Math.sin(angle) * 3.7, i * 0.013], i * 3);
    normal.set([Math.cos(angle), Math.sin(angle), 0.5], i * 3);
    uv.set([i / count, 1 - i / count], i * 2);
    color.set([i / count, 0.25, 1], i * 3);
  }
  const indices: number[] = [];
  for (let t = 0; t < triangles; t++) indices.push(0, t + 1, t + 2);
  const attributes = {
    POSITION: { itemSize: 3, array: position },
    NORMAL: { itemSize: 3, array: normal },
    TEXCOORD_0: { itemSize: 2, array: uv },
    COLOR_0: { itemSize: 3, array: color },
  };
  return { encoded: encodeGeometryPage(indices, attributes, exponent), indices, attributes };
}

test('a page decodes to its triangles, every attribute within the declared error', () => {
  const { encoded, indices, attributes } = page(40);
  const decoded = decodeGeometryPage(encoded.data);
  assert.equal(decoded.vertexCount, 42);
  assert.equal(decoded.flags, 1 | 2 | 8);
  assert.equal(decoded.decodedBytes, encoded.uncompressedBytes);
  assert.deepEqual(Object.keys(decoded.attributes), ['position', 'normal', 'uv', 'color']);
  const step = 2 ** -10;
  for (let corner = 0; corner < indices.length; corner++) {
    const local = decoded.indices[corner],
      source = indices[corner];
    let distance = 0,
      dot = 0;
    for (let c = 0; c < 3; c++) {
      distance += (decoded.attributes.position[local * 3 + c] - attributes.POSITION.array[source * 3 + c]) ** 2;
      dot += decoded.attributes.normal[local * 3 + c] * attributes.NORMAL.array[source * 3 + c];
    }
    assert.ok(Math.sqrt(distance) <= encoded.quantizationError + 1e-9, `position ${corner}`);
    assert.ok(Math.sqrt(distance) <= (step * Math.sqrt(3)) / 2 + 1e-9);
    assert.ok(Math.acos(dot / Math.hypot(1, 0.5)) < (1 * Math.PI) / 180, `normal ${corner}`);
    for (let c = 0; c < 2; c++)
      assert.ok(Math.abs(decoded.attributes.uv[local * 2 + c] - attributes.TEXCOORD_0.array[source * 2 + c]) <= 2 ** -15 + 1e-9);
    assert.ok(Math.abs(decoded.attributes.color[local * 4] - attributes.COLOR_0.array[source * 3]) <= 0.5 / 256 + 1e-6);
    assert.equal(decoded.attributes.color[local * 4 + 3], 1);
  }
});

test('vertices that land on the same cells are kept once and the indices remapped', () => {
  const position = new Float32Array([0, 0, 0, 1, 0, 0, 1 + 2 ** -12, 0, 0, 0, 1, 0]);
  const encoded = encodeGeometryPage([0, 1, 3, 0, 2, 3], { POSITION: { itemSize: 3, array: position } }, -4);
  const decoded = decodeGeometryPage(encoded.data);
  assert.equal(decoded.vertexCount, 3);
  assert.deepEqual(Array.from(decoded.indices), [0, 1, 2, 0, 1, 2]);
  assert.deepEqual(Array.from(decoded.attributes.position.subarray(3, 6)), [1, 0, 0]);
});

test('a short header, a wrong version, a field beyond the format, a forged index and a truncation are refused in that order', () => {
  const { encoded } = page(4);
  assert.throws(() => decodeGeometryPage(encoded.data.subarray(0, 16)), /GEOMETRY_PAGE_HEADER/);
  const version = Uint8Array.from(encoded.data);
  version[4] = 2;
  assert.throws(() => decodeGeometryPage(version), /GEOMETRY_PAGE_VERSION/);
  const wide = Uint8Array.from(encoded.data);
  wide[20] = 25; // Position x width: 25 of the 6 bits, above 24.
  assert.throws(() => decodeGeometryPage(wide), /GEOMETRY_PAGE_BOUNDS/);
  assert.throws(() => decodeGeometryPage(encoded.data.subarray(0, encoded.data.length - 4)), /GEOMETRY_PAGE_BOUNDS/);
  assert.throws(() => decodeGeometryPage(encoded.data, 16), /GEOMETRY_PAGE_BOUNDS/);
  const forged = Uint8Array.from(encoded.data);
  forged[96] = 0xff; // Every field of the first index word set: 63 > 5 vertices.
  assert.throws(() => decodeGeometryPage(forged), /GEOMETRY_PAGE_INDEX/);
});
