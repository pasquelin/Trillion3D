// A13: the attribute-read plan is computed once per page and values are read by
// typed view (little-endian) rather than by a closure and a DataView per vertex. Oracle: the
// DataView-everywhere version from before batch A, in `bench/oracles/attributs-telemetrie.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePageAttributes } from './geometryPage.ts';
import { referenceDecode } from './bench/oracles/attributs-telemetrie.mjs';

const FLAGS_NORMAL = 1,
  FLAGS_UV = 2;

/** A small page: `vertexCount` vertices, indices increasing triangle by triangle. */
function page(vertexCount: number, flags: number, stride: number) {
  const indexCount = Math.max(0, vertexCount - (vertexCount % 3));
  const indexData = new Uint8Array(indexCount * 2);
  const indexView = new DataView(indexData.buffer);
  for (let i = 0; i < indexCount; i++) indexView.setUint16(i * 2, i % vertexCount, true);
  const vertexData = new Uint8Array(vertexCount * stride);
  const vertexView = new DataView(vertexData.buffer);
  for (let i = 0; i < vertexCount; i++) {
    let offset = i * stride;
    for (let c = 0; c < 3; c++) {
      vertexView.setFloat32(offset, i + c * 0.1, true);
      offset += 4;
    }
    if (flags & FLAGS_NORMAL) {
      for (let c = 0; c < 3; c++) {
        vertexView.setFloat32(offset, c === 1 ? 1 : 0, true);
        offset += 4;
      }
    } else offset += 12;
    if (flags & FLAGS_UV) {
      for (let c = 0; c < 2; c++) {
        vertexView.setFloat32(offset, i * 0.01 + c, true);
        offset += 4;
      }
    }
  }
  return { indexData, vertexData, indexCount, vertexCount };
}

function agree(vertexCount: number, flags: number, stride: number) {
  const { indexData, vertexData, indexCount } = page(vertexCount, flags, stride);
  const optimisee = decodePageAttributes(
    indexData,
    vertexData,
    indexCount,
    vertexCount,
    flags,
    stride,
  );
  const reference = referenceDecode(indexData, vertexData, indexCount, vertexCount, flags, stride);
  assert.deepEqual(Array.from(optimisee.indices), Array.from(reference.indices));
  assert.deepEqual(
    Object.keys(optimisee.attributes).sort(),
    Object.keys(reference.attributes).sort(),
  );
  for (const name of Object.keys(optimisee.attributes)) {
    const a = optimisee.attributes[name],
      b = reference.attributes[name];
    assert.equal(a.length, b.length, name);
    for (let i = 0; i < a.length; i++)
      assert.ok(Object.is(a[i], b[i]), `${name}[${i}]: ${a[i]} ≠ ${b[i]}`);
  }
}

test('a single vertex, no optional attributes, decodes identically to the reference', () => {
  agree(3, 0, 12);
});

test('all optional attributes present decodes identically, including uv2/color/tangent widths', () => {
  agree(9, 1 | 2 | 4 | 8 | 16, 3 * 4 + (3 + 2 + 4 + 2 + 4) * 4);
});

test('a page with zero vertices and zero indices never crashes and matches the reference', () => {
  const indexData = new Uint8Array(0),
    vertexData = new Uint8Array(0);
  const optimisee = decodePageAttributes(indexData, vertexData, 0, 0, 0, 12);
  const reference = referenceDecode(indexData, vertexData, 0, 0, 0, 12);
  assert.deepEqual(Array.from(optimisee.indices), Array.from(reference.indices));
  assert.equal(optimisee.attributes.position.length, 0);
});

test('an index at or beyond vertexCount throws GEOMETRY_PAGE_INDEX on both sides', () => {
  const indexData = new Uint8Array(2);
  new DataView(indexData.buffer).setUint16(0, 5, true); // Only 1 vertex exists.
  const vertexData = new Uint8Array(12);
  assert.throws(
    () => decodePageAttributes(indexData, vertexData, 1, 1, 0, 12),
    /GEOMETRY_PAGE_INDEX/,
  );
  assert.throws(() => referenceDecode(indexData, vertexData, 1, 1, 0, 12), /GEOMETRY_PAGE_INDEX/);
});

test('a non-finite (NaN/Infinity) float in the vertex buffer throws GEOMETRY_PAGE_NONFINITE on both sides', () => {
  const indexData = new Uint8Array(2);
  const vertexData = new Uint8Array(12);
  new DataView(vertexData.buffer).setFloat32(4, NaN, true);
  assert.throws(
    () => decodePageAttributes(indexData, vertexData, 0, 1, 0, 12),
    /GEOMETRY_PAGE_NONFINITE/,
  );
  assert.throws(
    () => referenceDecode(indexData, vertexData, 0, 1, 0, 12),
    /GEOMETRY_PAGE_NONFINITE/,
  );
});
