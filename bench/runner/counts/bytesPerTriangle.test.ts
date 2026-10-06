import assert from 'node:assert/strict';
import test from 'node:test';
import { bytesPerTriangle } from './bytesPerTriangle.ts';

/** Two primitives: one with quantized pages, one without any page geometry. */
const manifest = {
  key: 'k',
  compilerVersion: '0.8.0',
  primitives: [
    {
      quantization: {
        positionExponent: -10,
        uvExponent: -14,
        maxPositionError: 0.0004,
      },
      pages: [
        {
          count: 384,
          bytes: 1536,
          level: 0,
          geometry: { bytes: 640, uncompressedBytes: 8448, vertexCount: 96 },
        },
        {
          count: 300,
          bytes: 1200,
          level: 1,
          geometry: { bytes: 500, uncompressedBytes: 6600, vertexCount: 80 },
        },
      ],
    },
    { pages: [{ count: 30, bytes: 120, level: 0 }] },
    { quantization: null, pages: [] },
  ],
};

test('the figures divide page bytes by the triangles of the pages that carry geometry', () => {
  const figures = bytesPerTriangle(manifest);
  assert.ok(figures);
  assert.equal(figures.pages, 2);
  assert.equal(figures.triangles, 228);
  assert.equal(figures.exactTriangles, 128);
  assert.equal(figures.packedBytesPerTriangle, 1140 / 228);
  assert.equal(figures.floatBytesPerTriangle, 15048 / 228);
  assert.equal(figures.verticesPerTriangle, 176 / 228);
  assert.equal(figures.indexPageBytesPerTriangle, 2736 / 228);
  assert.equal(figures.maxPositionError, 0.0004);
  assert.equal(figures.positionStep, 2 ** -10);
  assert.equal(bytesPerTriangle({ key: 'e', primitives: [{ pages: [] }] }), null);
});
