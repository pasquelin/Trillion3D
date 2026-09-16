import test from 'node:test';
import assert from 'node:assert/strict';
import { VIS_SHADER } from './visibilityShaderId.ts';
import {
  hoisted,
  perVertex,
  IDENTITY,
  MIRROR_X,
  NEAR_SINGULAR,
  LARGE_SCALE,
  type Mat4,
  type Vec4,
} from './bench/oracles/mat4HoistOracle.ts';

// Le repli materiel dessine TOUTE la coupe opaque : le raster de calcul ayant pris les triangles
// de toutes tailles, le seuil qui ecartait les petits n'existe plus, et aucun triangle ne peut
// tomber entre les deux producteurs. Le comportement teste ensuite reste celui du produit hisse :
// les trois sommets projetes avec le produit nomme une fois sont ceux qu'un produit refait pour
// chacun aurait donnes, sur des matrices hostiles.

test('le repli materiel ne connait plus de seuil de petit triangle', () => {
  assert.doesNotMatch(VIS_SHADER, /computeTriangle/);
  assert.doesNotMatch(VIS_SHADER, /smallThreshold/);
  assert.match(VIS_SHADER, /if\(vertexIndex>=page\.indexCount\)\{/);
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

test('sommets projetes identiques, matrice identite', () => {
  assertSameTriangle(IDENTITY, IDENTITY, TRIANGLE);
});

test('sommets projetes identiques, matrice miroir (echelle negative importee)', () => {
  assertSameTriangle(IDENTITY, MIRROR_X, TRIANGLE);
  assertSameTriangle(MIRROR_X, MIRROR_X, TRIANGLE);
});

test('sommets projetes identiques, matrice quasi-singuliere', () => {
  assertSameTriangle(IDENTITY, NEAR_SINGULAR, TRIANGLE);
});

test('sommets projetes identiques, grande echelle (monde importe en millimetres)', () => {
  assertSameTriangle(LARGE_SCALE, IDENTITY, TRIANGLE);
  assertSameTriangle(LARGE_SCALE, MIRROR_X, TRIANGLE);
});
