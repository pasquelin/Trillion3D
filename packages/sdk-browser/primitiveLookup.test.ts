// Batch F, F16 (primitiveLookup.ts): `primitiveFinder` replaces an `Array.prototype.find` relaunched
// per mesh — O(n²) on a manifest with n primitives — with two tables built once. It must
// return exactly what `find` returned, including on duplicate keys (the first wins),
// a missing association, and a NaN key (`===` never finds NaN, neither does `find`). The oracle is
// that `find` from before batch F, applied here because `pageSelectionCollect.ts` and
// `explorerScene.ts` did not export it separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { primitiveFinder } from './primitiveLookup.ts';
import type { Primitive } from '../sdk-core/src/index.ts';

const prim = (mesh: number, primitive: number, tag: string) =>
  ({ mesh, primitive, tag }) as unknown as Primitive;

/** `find` from before batch F, as it appeared in `pageSelectionCollect.ts` and `explorerScene.ts`. */
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

test('an empty manifest never finds anything', () => {
  memeResultat([], { meshes: 0, primitives: 0 });
  memeResultat([], undefined);
});

test('undefined association looks up the pair (undefined, 0), which nothing ever carries', () => {
  const primitives = [prim(0, 0, 'a'), prim(1, 0, 'b')];
  memeResultat(primitives, undefined);
});

test('primitives default to 0 when the association does not specify them', () => {
  const primitives = [prim(2, 0, 'a')];
  memeResultat(primitives, { meshes: 2 });
});

test('a duplicate key (same mesh, same primitive): the first declared wins', () => {
  const premiere = prim(3, 1, 'premiere');
  const primitives = [premiere, prim(3, 1, 'seconde'), prim(3, 1, 'troisieme')];
  const finder = primitiveFinder(primitives);
  assert.equal(finder({ meshes: 3, primitives: 1 }), premiere);
  assert.equal(
    finder({ meshes: 3, primitives: 1 }),
    referenceFind(primitives, { meshes: 3, primitives: 1 }),
  );
});

test('a NaN mesh or NaN primitive in the manifest is never findable, as with ===', () => {
  const primitives = [prim(NaN, 0, 'meshNaN'), prim(4, NaN, 'primNaN'), prim(4, 0, 'valide')];
  memeResultat(primitives, { meshes: NaN, primitives: 0 });
  memeResultat(primitives, { meshes: 4, primitives: NaN });
  memeResultat(primitives, { meshes: 4, primitives: 0 });
});

test('an association that asks for NaN never finds anything, even if an item carries NaN', () => {
  const primitives = [prim(NaN, 0, 'meshNaN')];
  memeResultat(primitives, { meshes: NaN, primitives: 0 });
});

test('several meshes and several primitives per mesh: each pair finds exactly its item', () => {
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
