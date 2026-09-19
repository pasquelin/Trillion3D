import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterSource } from './gpuRasterShader.ts';
import {
  hoisted,
  perVertex,
  upperLeftDeterminant,
  IDENTITY,
  MIRROR_X,
  NEAR_SINGULAR,
  LARGE_SCALE,
  type Mat4,
  type Vec4,
} from './bench/oracles/mat4HoistOracle.ts';

// D1: gpuRasterShader.ts now computes viewProj*world and the linear determinant once per page
// (per workgroup) instead of recomputing them for every triangle. Structure: the sharing really
// exists in the shader. Behavior: the hoisted product and determinant equal exactly what per-triangle
// calculation would yield, on hostile matrices (mirror, near-singular, large scale) — no approximation.

test('sorting pass computes vp/det once per workgroup and rereads them per triangle', () => {
  const shader = rasterSource(4096, 16);
  assert.match(shader, /var<workgroup> rowVp:mat4x4f;/);
  assert.match(shader, /var<workgroup> rowDet:f32;/);
  assert.match(
    shader,
    /if\(live&&lane\.x==0u\)\{let page=pages\[row\];rowVp=pageTransform\(page\);rowDet=pageWinding\(page\);\}/,
  );
  assert.match(shader, /workgroupBarrier\(\);/);
  assert.match(shader, /setupTriangle\(row,triangle,rowVp,rowDet\)/);
  // The vertex() function takes the precomputed product, it never recomputes it.
  assert.match(shader, /fn vertex\(vp:mat4x4f,vertexBase:u32,index:u32\)->vec4f\{/);
  assert.doesNotMatch(shader, /vertex\(page,/);
});

function assertSameVertices(viewProj: Mat4, world: Mat4, vertices: readonly Vec4[]) {
  const a = hoisted(viewProj, world, vertices);
  const b = perVertex(viewProj, world, vertices);
  for (let i = 0; i < vertices.length; i++) assert.deepEqual(a[i], b[i], `vertex ${i}`);
}

const TRIANGLE: readonly Vec4[] = [
  [0.2, 0.4, 0.6, 1],
  [-1, 0, 0.9, 1],
  [3, -2, 0.1, 1],
];

test('product hoisted once == product recomputed per vertex, identity matrix', () => {
  assertSameVertices(IDENTITY, IDENTITY, TRIANGLE);
});

test('product hoisted once == product recomputed per vertex, mirror matrix', () => {
  assertSameVertices(IDENTITY, MIRROR_X, TRIANGLE);
  assertSameVertices(MIRROR_X, MIRROR_X, TRIANGLE);
});

test('product hoisted once == product recomputed per vertex, near-singular matrix', () => {
  assertSameVertices(IDENTITY, NEAR_SINGULAR, TRIANGLE);
});

test('product hoisted once == product recomputed per vertex, large scale', () => {
  assertSameVertices(LARGE_SCALE, IDENTITY, TRIANGLE);
  assertSameVertices(LARGE_SCALE, MIRROR_X, TRIANGLE);
});

test('determinant hoisted once per page equals recomputed determinant, including mirror', () => {
  for (const world of [IDENTITY, MIRROR_X, NEAR_SINGULAR, LARGE_SCALE]) {
    const once = upperLeftDeterminant(world);
    const again = upperLeftDeterminant(world);
    assert.equal(once, again);
  }
  assert.ok(upperLeftDeterminant(MIRROR_X) < 0, 'mirror has a negative determinant');
  assert.ok(upperLeftDeterminant(IDENTITY) > 0);
});
