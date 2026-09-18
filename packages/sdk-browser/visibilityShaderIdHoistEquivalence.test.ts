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
} from './bench/oracles/mat4HoistOracle.ts';

// Le repli materiel dessine TOUTE la coupe opaque : le raster de calcul ayant pris les triangles
// de toutes tailles, le seuil qui ecartait les petits n'existe plus, et aucun triangle ne peut
// tomber entre les deux producteurs. Le comportement teste ensuite reste celui du produit hisse :
// les trois sommets projetes avec le produit nomme une fois sont ceux qu'un produit refait pour
// chacun aurait donnes, sur des matrices hostiles.

test('le raster matériel lit le partage dans le même texte que le raster de calcul', () => {
  // Le même prédicat, sur le même produit hissé `viewProj*world` : un triangle a exactement un
  // des deux rasters. À zéro, l'étage de sommets ne lit pas un sommet de plus.
  assert.ok(VIS_SHADER.includes(COMPUTE_TAKES_WGSL));
  assert.ok(rasterSource(4, 16).includes(COMPUTE_TAKES_WGSL));
  assert.match(
    VIS_SHADER,
    /fn leftToCompute\(page:PageInfo,triangle:u32\)->bool\{\n if\(uni\.computeSpan<=0\.0\)\{return false;\}/,
  );
  assert.match(VIS_SHADER, /let vp=uni\.viewProj\*page\.world;/);
  assert.match(
    VIS_SHADER,
    /if\(vertexIndex>=page\.indexCount\|\|leftToCompute\(page,vertexIndex\/3u\)\)\{/,
  );
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
