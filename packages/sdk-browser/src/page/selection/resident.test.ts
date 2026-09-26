// The residency rule of a cut: nothing held, every page is resident; held without a host rule,
// a page is resident when it holds its index array; held with one, the host's answer decides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClusterPages, selectVisiblePages } from './selection.ts';
import { blendFixture, camera } from './blend.fixture.ts';
import { cameraMoteur } from '../../camera/camera.fixture.ts';
import { createHeldResidency } from '../cut/held.ts';

test('the cut follows its residency rule: without an index array, the page is requested but not shown', () => {
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
  const libre = selectVisiblePages(roots, cameraMoteur(cam), {});
  assert.equal(libre.shown.length, libre.wanted.length || libre.shown.length);
  assert.ok(libre.shown.length > 0);
  // Held without a host answer: residency is the index array, which no page has.
  const tenu = selectVisiblePages(roots, cameraMoteur(cam), { held: createHeldResidency() });
  assert.equal(tenu.shown.length, 0);
  assert.equal(tenu.complete, false);
  // Held with a host answer: that is what decides, not the index array.
  const demande = selectVisiblePages(roots, cameraMoteur(cam), {
    held: createHeldResidency({ isResident: () => true }),
  });
  assert.ok(demande.shown.length > 0);
  assert.equal(demande.complete, true);
  fixture.geometry.dispose();
  fixture.material.dispose();
});
