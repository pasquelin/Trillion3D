// Shared formulae lot: packedRowBase, factored out of 2 copies (first write of a row and the
// compact that moves it).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { packedRowBase } from './pageRow.ts';
import { emptyGeometryBlock, rowGeometry, rowMaterial } from './pageRowMaterial.ts';
import { FLAG_UV } from '../../cluster/format.ts';
import { FLAG_CLUSTER_PAGE, VIS_TRIANGLE_BITS } from '../../visibility/buffer.ts';
import { visMaterial } from '../../visibility/shader/material.ts';

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
  const source = {
    vertexBase: 7,
    count: 3,
    hasUv: true,
    hasNormal: true,
    hasTangent: true,
    hasColor: false,
  };
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
    {
      vertexBase: 0,
      count: 3,
      hasUv: true,
      hasNormal: false,
      hasTangent: false,
      hasColor: false,
      quantized: true,
    },
  );
});

// The bit only says where the geometry is read; it never splits a resolve class in two.
test('the cluster-page flag rides the row without moving its material class', () => {
  const layers = { mapLayer: new Map(), dataLayer: new Map() };
  const material = visMaterial(G.standardSurface());
  const source = {
    vertexBase: 0,
    count: 3,
    hasUv: true,
    hasNormal: true,
    hasTangent: false,
    hasColor: false,
  };
  const plain = rowMaterial(material, source, layers);
  const paged = rowMaterial(material, { ...source, quantized: true }, layers);
  assert.equal(paged.classKey, plain.classKey);
  assert.equal(paged.flags, plain.flags | FLAG_CLUSTER_PAGE);
});

// Review of #389: whether a page runs the filter rule is the page's, read off its maps' headers,
// never tested per sample: a page whose maps are all at the default carries no `FLAG_SAMPLED`,
// and its resolve class compiles the default read alone.

// #347: a page that carries `COLOR_0` — a runtime cut, a compiled glTF — is drawn with its vertex
// colours when its material asks for them, as the forward path draws it; any other row keeps the
// flags and the class it had, so nothing it draws moves.
