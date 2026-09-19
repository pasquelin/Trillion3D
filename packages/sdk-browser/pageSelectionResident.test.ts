// The other changed behaviour: the residency rule is resolved once per cut instead of being
// re-read on the state at every kept cluster. It must yield, over the whole product of the
// inputs, exactly what the pre-lot closure used to yield — copied here as an oracle.
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
import { cameraMoteur } from './cameraFixture.ts';

/** `pageSelectionCutState.ts` before this lot: residency re-read on the state, cluster by cluster. */
function oracle<T extends PageRecord>(
  hold: boolean,
  isResident: ((page: T) => boolean) | undefined,
  rec: T,
) {
  return !hold || (isResident ? isResident(rec) : !!rec.array);
}

test("the resolved mode yields the pre-lot closure's answer, over the whole product of the inputs", () => {
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

test('the three modes are those the request describes, and those alone', () => {
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

test('the cut follows this mode: without an index array, the page is requested but not shown', () => {
  const fixture = blendFixture();
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  );
  for (const page of allPages) page.array = undefined;
  const cam = camera();
  // Nothing is held: residency is not a question, everything chosen is shown.
  const libre = selectVisiblePages(roots, cameraMoteur(cam), { holdResident: false });
  assert.equal(libre.shown.length, libre.wanted.length || libre.shown.length);
  assert.ok(libre.shown.length > 0);
  // Held without a host answer: residency is the index array, which no page has.
  const tenu = selectVisiblePages(roots, cameraMoteur(cam), { holdResident: true });
  assert.equal(tenu.shown.length, 0);
  assert.equal(tenu.complete, false);
  // Held with a host answer: that is what decides, not the index array.
  const demande = selectVisiblePages(roots, cameraMoteur(cam), {
    holdResident: true,
    isResident: () => true,
  });
  assert.ok(demande.shown.length > 0);
  assert.equal(demande.complete, true);
  fixture.geometry.dispose();
  fixture.material.dispose();
});
