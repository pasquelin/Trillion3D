import test from 'node:test';
import assert from 'node:assert/strict';
import { ESCALATION_SLACK } from './pageSelectionTypes.ts';
import {
  fixturePages,
  fixtureUniforms,
  mountCutAdopter,
  peekOnly,
} from './webgpuCutAdopterFixture.ts';
import type { GpuCut } from './gpuSelection.ts';

/** An adopter and its cut, whose completeness is set shown-list by shown-list. */
function banc(ids: number[]) {
  const packedPages = fixturePages(ids.length);
  const shared = fixtureUniforms();
  const releve = (complete: boolean): GpuCut =>
    ({
      uniforms: shared,
      result: { pageIds: ids, drawablePageIds: ids, frustumRejected: 0, lodLevel: 0, complete },
    }) as GpuCut;
  let peeked: GpuCut | null = releve(false);
  const mounted = mountCutAdopter({
    packedPages,
    residentOffsetWords: new Int32Array(packedPages.length).fill(0),
    uniforms: shared,
    selection: () => peekOnly(() => peeked),
  });
  return { ...mounted, montre: (complete: boolean) => (peeked = releve(complete)) };
}

test('a wanted page that has not arrived yet puts the frame on hold, without dropping GPU selection', () => {
  const b = banc([0, 1, 2, 3]);
  // The shown list announces a hole: a page the kernel wants to draw is not resident.
  assert.doesNotThrow(() => b.adopter.adopt(), 'incomplete coverage is not an error');
  assert.equal(b.adopter.adopt(), false, 'the frame does not adopt an incomplete shown list');
  assert.equal(b.adopter.metrics.incomplete, true, 'and it says so');
  assert.equal(b.adopter.metrics.ready, false, 'no count from the shown list is published');
  // Typed as `typeof b.shown`, not a bare `[]`: `assert/strict`'s `deepEqual` is `deepStrictEqual`,
  // whose `expected` sets the narrowed type of `actual` afterwards.
  assert.deepEqual(b.shown, [] as typeof b.shown, 'nothing is drawn from an incomplete shown list');
  // The wanted list is published anyway: it is what fetches the missing page.
  assert.deepEqual(
    b.desired.map((page) => page.url),
    ['p0', 'p1', 'p2', 'p3'],
  );

  // The page arrives: the next shown list is complete and GPU selection draws again.
  b.montre(true);
  assert.equal(b.adopter.adopt(), true);
  assert.equal(b.adopter.metrics.incomplete, false);
  assert.equal(b.adopter.metrics.ready, true);
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p0', 'p1', 'p2', 'p3'],
  );
});

test('the escalation threshold is set strictly above the parent error, in f32', () => {
  // Escalation used to set the threshold AT the parent error: both choice flips rested on an
  // exact equality between a value one pass wrote and the same one another recomputed. On the
  // device, the driver does not yield the same f32 from one entry point to another — drift
  // measured on `dagMask`: 1 to 13 units in the last place. The slack must cover that drift
  // generously.
  const ulps = (valeur: number) => {
    const bits = new Uint32Array(1),
      flottant = new Float32Array(bits.buffer);
    flottant[0] = valeur;
    const bas = bits[0]!;
    flottant[0] = Math.fround(valeur * ESCALATION_SLACK);
    return bits[0]! - bas;
  };
  for (const erreur of [1e-4, 0.017, 0.25, 1, 3.7, 64, 4096, 1e6]) {
    assert.ok(
      Math.fround(erreur * ESCALATION_SLACK) > erreur,
      `the escalated threshold must exceed ${erreur}`,
    );
    assert.ok(ulps(erreur) >= 256, `slack of ${ulps(erreur)} units in the last place on ${erreur}`);
  }
  // And it stays four orders of magnitude under a pixel: the cut is not changed by it.
  assert.ok(ESCALATION_SLACK - 1 < 1e-4);
});
