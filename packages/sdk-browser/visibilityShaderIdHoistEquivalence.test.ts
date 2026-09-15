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

// D2 : visibilityShaderId.ts nomme desormais viewProj*world une fois par triangle (computeTriangle)
// au lieu de le refaire pour chacun des trois sommets de la boite ecran. Structure : le nommage
// existe reellement. Comportement : les trois sommets projetes avec le produit nomme une fois sont
// exactement ceux qu'un produit refait pour chacun aurait donnes, sur des matrices hostiles.

test('computeTriangle nomme viewProj*world une fois et le relit pour les trois sommets', () => {
  assert.match(VIS_SHADER, /let vp=uni\.viewProj\*page\.world;/);
  assert.match(VIS_SHADER, /let a=vp\*vec4f\(vertPos\(page\.vertexBase,ia\),1\.0\);/);
  assert.match(VIS_SHADER, /let b=vp\*vec4f\(vertPos\(page\.vertexBase,ib\),1\.0\);/);
  assert.match(VIS_SHADER, /let c=vp\*vec4f\(vertPos\(page\.vertexBase,ic\),1\.0\);/);
  // Le produit ne doit apparaitre qu'une fois dans computeTriangle, pas une fois par sommet.
  const body = VIS_SHADER.slice(
    VIS_SHADER.indexOf('fn computeTriangle'),
    VIS_SHADER.indexOf('@vertex fn vis_vs'),
  );
  const code = body
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const occurrences = code.match(/uni\.viewProj\s*\*\s*page\.world/g) ?? [];
  assert.equal(
    occurrences.length,
    1,
    'uni.viewProj*page.world ne doit etre ecrit qu une fois hors commentaire',
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
