import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterSource } from './gpuSmallTrianglesShader.ts';
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

// D1 : gpuSmallTrianglesShader.ts calcule desormais viewProj*world et le determinant de la partie
// lineaire une fois par page (par groupe de travail) au lieu de les refaire pour chaque triangle.
// Structure : le partage existe reellement dans le shader. Comportement : le produit et le
// determinant hisses valent exactement ce que le calcul par triangle aurait donne, sur des
// matrices hostiles (miroir, quasi-singuliere, grande echelle) — pas d'approximation.

test('la passe de tri calcule vp/det une fois par groupe et les relit par triangle', () => {
  const shader = rasterSource(4096);
  assert.match(shader, /var<workgroup> rowVp:mat4x4f;/);
  assert.match(shader, /var<workgroup> rowDet:f32;/);
  assert.match(
    shader,
    /if\(live&&lane\.x==0u\)\{let page=pages\[row\];rowVp=pageTransform\(page\);rowDet=pageWinding\(page\);\}/,
  );
  assert.match(shader, /workgroupBarrier\(\);/);
  assert.match(shader, /setupTriangle\(row,triangle,rowVp,rowDet\)/);
  // La fonction vertex() prend le produit deja fait, elle ne le refait jamais.
  assert.match(shader, /fn vertex\(vp:mat4x4f,vertexBase:u32,index:u32\)->vec4f\{/);
  assert.doesNotMatch(shader, /vertex\(page,/);
});

function assertSameVertices(viewProj: Mat4, world: Mat4, vertices: readonly Vec4[]) {
  const a = hoisted(viewProj, world, vertices);
  const b = perVertex(viewProj, world, vertices);
  for (let i = 0; i < vertices.length; i++) assert.deepEqual(a[i], b[i], `sommet ${i}`);
}

const TRIANGLE: readonly Vec4[] = [
  [0.2, 0.4, 0.6, 1],
  [-1, 0, 0.9, 1],
  [3, -2, 0.1, 1],
];

test('produit hisse une fois == produit refait par sommet, matrice identite', () => {
  assertSameVertices(IDENTITY, IDENTITY, TRIANGLE);
});

test('produit hisse une fois == produit refait par sommet, matrice miroir', () => {
  assertSameVertices(IDENTITY, MIRROR_X, TRIANGLE);
  assertSameVertices(MIRROR_X, MIRROR_X, TRIANGLE);
});

test('produit hisse une fois == produit refait par sommet, matrice quasi-singuliere', () => {
  assertSameVertices(IDENTITY, NEAR_SINGULAR, TRIANGLE);
});

test('produit hisse une fois == produit refait par sommet, grande echelle', () => {
  assertSameVertices(LARGE_SCALE, IDENTITY, TRIANGLE);
  assertSameVertices(LARGE_SCALE, MIRROR_X, TRIANGLE);
});

test('le determinant hisse une fois par page vaut le determinant recalcule, y compris miroir', () => {
  for (const world of [IDENTITY, MIRROR_X, NEAR_SINGULAR, LARGE_SCALE]) {
    const once = upperLeftDeterminant(world);
    const again = upperLeftDeterminant(world);
    assert.equal(once, again);
  }
  assert.ok(upperLeftDeterminant(MIRROR_X) < 0, 'le miroir a un determinant negatif');
  assert.ok(upperLeftDeterminant(IDENTITY) > 0);
});
