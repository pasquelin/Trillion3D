// Shared formulae lot: packedRowBase, factored out of 2 copies (first write of a row and the
// compact that moves it).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { packedRowBase } from './pageRow.ts';
import { createPageRowConstants } from './pageRowConstants.ts';
import { surfaceOf } from '../../page/surface.ts';
import { emptyGeometryBlock, rowGeometry, rowMaterial } from './pageRowMaterial.ts';
import { FLAG_UV } from '../../cluster/format.ts';
import { FLAG_CLUSTER_PAGE, VIS_TRIANGLE_BITS, visMaterial } from '../../visibility/buffer.ts';

test('packedRowBase shifts the rank by VIS_TRIANGLE_BITS bits, one rank further than the rank', () => {
  assert.equal(packedRowBase(0), 1 << VIS_TRIANGLE_BITS);
  assert.equal(packedRowBase(5), 6 << VIS_TRIANGLE_BITS);
});

test('packedRowBase at the first row (rank 0) reserves zero for the background', () => {
  assert.equal(packedRowBase(0), 256);
  assert.notEqual(packedRowBase(0), 0);
});

test('packedRowBase returns a 32-bit unsigned integer for a large rank', () => {
  const value = packedRowBase(0xffffff);
  assert.ok(Number.isInteger(value) && value >= 0);
  assert.equal(value, ((0xffffff + 1) << VIS_TRIANGLE_BITS) >>> 0);
});

// Where a row reads its geometry: the quantized page in its slot says which attributes it
// carries, and it carries no tangent — the resolve rebuilds the frame from the triangle.
test('a row over a quantized page takes its attributes from the page, never a tangent', () => {
  const block = emptyGeometryBlock();
  const source = { vertexBase: 7, count: 3, hasUv: true, hasNormal: true, hasTangent: true };
  const attributes = {} as never;
  const blocks = new Map([[attributes, source]]);
  assert.equal(rowGeometry({ attributes }, blocks, block), source);
  const geometryPage = {
    url: 'g',
    sha256: 'g',
    bytes: 64,
    vertexCount: 3,
    indexCount: 3,
    flags: FLAG_UV,
    uncompressedBytes: 128,
  };
  const paged = rowGeometry({ attributes, geometryPage }, blocks, block)!;
  assert.deepEqual(
    { ...paged },
    { vertexBase: 0, count: 3, hasUv: true, hasNormal: false, hasTangent: false, quantized: true },
  );
});

// The bit only says where the geometry is read; it never splits a resolve class in two.
test('the cluster-page flag rides the row without moving its material class', () => {
  const layers = { mapLayer: new Map(), dataLayer: new Map() };
  const material = visMaterial(new THREE.MeshStandardMaterial());
  const source = { vertexBase: 0, count: 3, hasUv: true, hasNormal: true, hasTangent: false };
  const plain = rowMaterial(material, source, layers);
  const paged = rowMaterial(material, { ...source, quantized: true }, layers);
  assert.equal(paged.classKey, plain.classKey);
  assert.equal(paged.flags, plain.flags | FLAG_CLUSTER_PAGE);
});

// #360, #361: the row writer is where a surface's moved version is seen, whatever wrote it — a
// world repaint or the host on its own material —; what the row does not carry, its maps'
// sampling, is told there, once per version read.
test('the row constants tell each surface version they read, once', () => {
  const host = new THREE.MeshStandardMaterial();
  const surface = surfaceOf(host as never);
  const told: unknown[] = [];
  const constants = createPageRowConstants((changed) => told.push(changed));
  constants.materialOf(surface);
  constants.materialOf(surface);
  assert.deepEqual(told, [surface], 'the first row');
  host.needsUpdate = true;
  constants.materialOf(surface);
  assert.deepEqual(told, [surface, surface], 'the version moved');
});
