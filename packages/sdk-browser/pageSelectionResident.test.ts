// L'autre comportement changé : la règle de résidence est résolue une fois par coupe au lieu
// d'être relue sur l'état à chaque cluster retenu. Elle doit rendre, sur tout le produit des
// entrées, exactement ce que rendait la fermeture d'avant le lot — recopiée ici comme oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESIDENT_ALL,
  RESIDENT_ARRAY,
  RESIDENT_ASK,
  residentModeOf,
  residentUnder,
  type PageRecord,
  type SelectionState,
} from './pageSelectionCutState.ts';
import { collectClusterPages, selectVisiblePages } from './pageSelection.ts';
import { blendFixture, camera } from './pageSelectionBlendFixture.ts';

/** `pageSelectionCutState.ts` avant ce lot : la résidence relue sur l'état, cluster par cluster. */
function oracle<T extends PageRecord>(
  hold: boolean,
  isResident: ((page: T) => boolean) | undefined,
  rec: T,
) {
  return !hold || (isResident ? isResident(rec) : !!rec.array);
}

test('le mode résolu rend la réponse de la fermeture d’avant, sur tout le produit des entrées', () => {
  const avec = { triangles: 1, array: new Uint32Array(3) } as PageRecord;
  const sans = { triangles: 1, array: undefined } as PageRecord;
  const vide = { triangles: 1 } as PageRecord;
  for (const hold of [false, true])
    for (const ask of [undefined, () => true, () => false])
      for (const rec of [avec, sans, vide]) {
        const mode = residentModeOf(hold, ask);
        const etat = { isResident: ask } as unknown as SelectionState<PageRecord>;
        assert.equal(residentUnder(etat, rec, mode), oracle(hold, ask, rec));
      }
});

test('les trois modes sont ceux que la demande décrit, et eux seuls', () => {
  assert.equal(residentModeOf(false, undefined), RESIDENT_ALL);
  assert.equal(
    residentModeOf(false, () => false),
    RESIDENT_ALL,
  );
  assert.equal(residentModeOf(true, undefined), RESIDENT_ARRAY);
  assert.equal(
    residentModeOf(true, () => false),
    RESIDENT_ASK,
  );
});

test('la coupe suit ce mode : sans tableau d’indices, la page est demandée mais pas affichée', () => {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  for (const page of allPages) page.array = undefined;
  const cam = camera();
  // Rien n'est tenu : la résidence n'est pas une question, tout ce qui est choisi est affiché.
  const libre = selectVisiblePages(roots, cam, { holdResident: false });
  assert.equal(libre.shown.length, libre.wanted.length || libre.shown.length);
  assert.ok(libre.shown.length > 0);
  // Tenu sans réponse de l'hôte : la résidence est le tableau d'indices, qu'aucune page n'a.
  const tenu = selectVisiblePages(roots, cam, { holdResident: true });
  assert.equal(tenu.shown.length, 0);
  assert.equal(tenu.complete, false);
  // Tenu avec réponse de l'hôte : c'est elle qui tranche, pas le tableau d'indices.
  const demande = selectVisiblePages(roots, cam, { holdResident: true, isResident: () => true });
  assert.ok(demande.shown.length > 0);
  assert.equal(demande.complete, true);
  fixture.geometry.dispose();
  fixture.material.dispose();
});
