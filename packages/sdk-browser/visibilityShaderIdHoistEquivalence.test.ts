import test from 'node:test';
import assert from 'node:assert/strict';
import { VIS_SHADER } from './visibilityShaderId.ts';
import { rasterSource } from './gpuRasterShader.ts';
import { COMPUTE_TAKES_WGSL } from './gpuRasterContract.ts';
import {
  hoisted,
  perVertex,
  IDENTITY,
  MIRROR_X,
  NEAR_SINGULAR,
  LARGE_SCALE,
  type Mat4,
  type Vec4,
} from '../../bench/oracles/browser/mat4HoistOracle.ts';

// The hardware fallback draws the WHOLE opaque cut: the compute raster having taken triangles
// of all sizes, the threshold that used to drop the small ones no longer exists, and no triangle
// can fall between the two producers. The behaviour tested next stays that of the hoisted product:
// the three vertices projected with the product named once are those a product redone for
// each would have given, on hostile matrices.

test('the hardware raster reads the share in the same text as the compute raster', () => {
  // The same predicate, on the same hoisted `viewProj*world` product: a triangle has exactly one
  // of the two rasters. At zero, the vertex stage does not read one more vertex.
  assert.ok(VIS_SHADER.includes(COMPUTE_TAKES_WGSL));
  assert.ok(rasterSource(4, 16).includes(COMPUTE_TAKES_WGSL));
  assert.match(
    VIS_SHADER,
    /fn hardwareIdle\(page:PageInfo,vertexIndex:u32\)->bool\{\n return vertexIndex>=page\.indexCount\|\|uni\.computeSpan>=1000000000;\n\}/,
  );
  assert.match(
    VIS_SHADER,
    /fn hardwareSkips\(page:PageInfo,h:ClusterHeader,vertexIndex:u32\)->bool\{\n if\(uni\.computeSpan<=0\.0\)\{return false;\}/,
  );
  assert.match(VIS_SHADER, /let vp=uni\.viewProj\*page\.world;/);
  assert.equal(VIS_SHADER.match(/if\(hardwareSkips\(page,h,vertexIndex\)\)\{/g)?.length, 2);
});

function assertSameTriangle(viewProj: Mat4, world: Mat4, vertices: readonly Vec4[]) {
  const a = hoisted(viewProj, world, vertices);
  const b = perVertex(viewProj, world, vertices);
  assert.deepEqual(a, b);
}

const TRIANGLE: readonly Vec4[] = [
  [0.1, -0.2, 0.3, 1],
  [1, 1, 0.5, 1],
  [-2, 0.4, 0.9, 1],
];

test('identical projected vertices, identity matrix', () => {
  assertSameTriangle(IDENTITY, IDENTITY, TRIANGLE);
});

test('identical projected vertices, mirror matrix (imported negative scale)', () => {
  assertSameTriangle(IDENTITY, MIRROR_X, TRIANGLE);
  assertSameTriangle(MIRROR_X, MIRROR_X, TRIANGLE);
});

test('identical projected vertices, near-singular matrix', () => {
  assertSameTriangle(IDENTITY, NEAR_SINGULAR, TRIANGLE);
});

test('identical projected vertices, large scale (world imported in millimetres)', () => {
  assertSameTriangle(LARGE_SCALE, IDENTITY, TRIANGLE);
  assertSameTriangle(LARGE_SCALE, MIRROR_X, TRIANGLE);
});
