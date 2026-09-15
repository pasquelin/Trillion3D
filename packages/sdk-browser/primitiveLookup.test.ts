// Lot F, F16 (primitiveLookup.ts) : `primitiveFinder` remplace un `Array.prototype.find` relancé par
// maillage — O(n²) sur un manifeste à n primitives — par deux tables construites une fois. Il doit
// rendre exactement ce que rendait `find`, y compris sur des clés dupliquées (la première l'emporte),
// une association absente, et une clé NaN (`===` ne trouve jamais NaN, `find` non plus). L'oracle est
// ce `find` d'avant le lot F, appliqué ici même puisque `pageSelectionCollect.ts` et
// `explorerScene.ts` ne l'exportaient pas séparément.
import test from 'node:test';
import assert from 'node:assert/strict';
import { primitiveFinder } from './primitiveLookup.ts';
import type { Primitive } from '../sdk-core/index.ts';

const prim = (mesh: number, primitive: number, tag: string) =>
  ({ mesh, primitive, tag }) as unknown as Primitive;

/** `find` d'avant le lot F, tel qu'il apparaissait dans `pageSelectionCollect.ts` et `explorerScene.ts`. */
function referenceFind(
  primitives: readonly Primitive[],
  association: { meshes?: number; primitives?: number } | undefined,
) {
  return primitives.find(
    (item) =>
      item.mesh === association?.meshes && item.primitive === (association?.primitives ?? 0),
  );
}

function memeResultat(
  primitives: Primitive[],
  association: { meshes?: number; primitives?: number } | undefined,
) {
  const finder = primitiveFinder(primitives);
  assert.equal(finder(association), referenceFind(primitives, association));
}

test('un manifeste vide ne trouve jamais rien', () => {
  memeResultat([], { meshes: 0, primitives: 0 });
  memeResultat([], undefined);
});

test('association undefined cherche le couple (undefined, 0), que rien ne porte jamais', () => {
  const primitives = [prim(0, 0, 'a'), prim(1, 0, 'b')];
  memeResultat(primitives, undefined);
});

test('primitives par défaut à 0 quand l’association ne le précise pas', () => {
  const primitives = [prim(2, 0, 'a')];
  memeResultat(primitives, { meshes: 2 });
});

test('une clé dupliquée (même mesh, même primitive) : la première déclarée l’emporte', () => {
  const premiere = prim(3, 1, 'premiere');
  const primitives = [premiere, prim(3, 1, 'seconde'), prim(3, 1, 'troisieme')];
  const finder = primitiveFinder(primitives);
  assert.equal(finder({ meshes: 3, primitives: 1 }), premiere);
  assert.equal(
    finder({ meshes: 3, primitives: 1 }),
    referenceFind(primitives, { meshes: 3, primitives: 1 }),
  );
});

test('un mesh NaN ou un primitive NaN dans le manifeste n’est jamais trouvable, comme avec ===', () => {
  const primitives = [prim(NaN, 0, 'meshNaN'), prim(4, NaN, 'primNaN'), prim(4, 0, 'valide')];
  memeResultat(primitives, { meshes: NaN, primitives: 0 });
  memeResultat(primitives, { meshes: 4, primitives: NaN });
  memeResultat(primitives, { meshes: 4, primitives: 0 });
});

test('une association qui demande NaN ne trouve jamais rien, même si un item porte NaN', () => {
  const primitives = [prim(NaN, 0, 'meshNaN')];
  memeResultat(primitives, { meshes: NaN, primitives: 0 });
});

test('plusieurs mesh et plusieurs primitives par mesh : chaque couple retrouve exactement son item', () => {
  const primitives: Primitive[] = [];
  for (let mesh = 0; mesh < 5; mesh++)
    for (let p = 0; p < 4; p++) primitives.push(prim(mesh, p, `${mesh}/${p}`));
  const finder = primitiveFinder(primitives);
  for (let mesh = 0; mesh < 5; mesh++)
    for (let p = 0; p < 4; p++) {
      const association = { meshes: mesh, primitives: p };
      assert.equal(finder(association), referenceFind(primitives, association), `${mesh}/${p}`);
    }
  memeResultat(primitives, { meshes: 5, primitives: 0 }); // mesh hors catalogue
  memeResultat(primitives, { meshes: 0, primitives: 99 }); // primitive hors catalogue
});
