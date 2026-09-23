import test from 'node:test';
import assert from 'node:assert/strict';
import { fixturePages, fixtureUniforms, mountCutAdopter, peekOnly } from './adopter.fixture.ts';
import type { GpuCut } from '../../gpu/core/selection.ts';
import type { PageRec } from '../../page/selection/selection.ts';

function banc(ids: number[]) {
  const packedPages = fixturePages(ids.length, (i) => i % 3 === 2);
  const residentOffsetWords = new Int32Array(packedPages.length).fill(0);
  const cut: GpuCut = {
    uniforms: fixtureUniforms(),
    result: { pageIds: ids, drawablePageIds: ids, frustumRejected: 0, lodLevel: 0 },
  } as GpuCut;
  let peeked: GpuCut | null = cut;
  const mounted = mountCutAdopter({
    packedPages,
    residentOffsetWords,
    uniforms: fixtureUniforms(),
    selection: () => peekOnly(() => peeked),
  });
  return {
    ...mounted,
    residentOffsetWords,
    packedPages,
    cut,
    montre: (next: GpuCut | null) => (peeked = next),
  };
}

test('a shown list already held does not remake the drawable list, and yields the same counts', () => {
  const b = banc([0, 1, 2, 3, 4]);
  assert.equal(b.adopter.adopt(), true);
  const { cutHeld: tenuPremier, listsRewritten: ecritPremier, ...premiers } = b.adopter.metrics;
  assert.equal(tenuPremier, false, 'the first shown list is not the one that was held');
  assert.equal(ecritPremier, true, 'and it rewrote the lists');
  const listeShown = b.shown,
    listeDrawn = b.drawn;
  const contenu = [...b.shown];
  // Spot a rewrite without depending on a clock: an intruder that only a rewrite erases.
  const intrus = { url: 'intrus' } as unknown as PageRec;
  b.shown.push(intrus);
  assert.equal(b.adopter.adopt(), true);
  assert.equal(b.shown, listeShown, 'the array itself does not change');
  assert.equal(b.drawn, listeDrawn);
  assert.equal(b.shown.at(-1), intrus, 'the held list is not remade');
  const { cutHeld: tenuSecond, listsRewritten: ecritSecond, ...seconds } = b.adopter.metrics;
  assert.deepEqual(seconds, premiers, 'the counts are those of the same shown list');
  assert.equal(tenuSecond, true, 'the held shown list is announced as such');
  assert.equal(ecritSecond, false, 'and nothing was rewritten');
  b.shown.pop();

  // Counts follow residency without the list moving: a hole appears, it does not change. The rank
  // journal names the page whose row just left; here the bench does it for it.
  b.residentOffsetWords[1] = -1;
  b.counts.touch(1);
  assert.equal(b.adopter.adopt(), true);
  assert.equal(b.adopter.metrics.uncoveredTriangles, 2, 'the hole is counted');
  assert.deepEqual(b.shown, contenu, 'the list stayed that of the shown list');
});

test('a new shown list remakes the list, and invalidation forgets the one that was held', () => {
  const b = banc([0, 1, 2, 3, 4]);
  assert.equal(b.adopter.adopt(), true);
  const attendu = [...b.shown];
  const autre: GpuCut = {
    uniforms: b.cut.uniforms,
    result: { pageIds: [3, 1], drawablePageIds: [3, 1], frustumRejected: 0, lodLevel: 0 },
  } as GpuCut;
  b.montre(autre);
  assert.equal(b.adopter.adopt(), true);
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p3', 'p1'],
  );
  assert.deepEqual(b.drawn, b.shown);
  assert.equal(b.adopter.metrics.drawnTriangles, 4 + 2);

  // After a CPU cut, the arrays no longer come from the shown list: it must be forgotten.
  b.montre(b.cut);
  assert.equal(b.adopter.adopt(), true);
  assert.deepEqual(b.shown, attendu);
  // Forgetting the shown list does not drop the difference: whoever wrote these lists published
  // it through it. Only the shown-list identity falls, so the displayed list is remade in full.
  b.adopter.forgetReadback();
  b.shown.length = 0;
  assert.equal(b.adopter.adopt(), true);
  assert.deepEqual(b.shown, attendu, 'the forgotten shown list is reread in full');
});

test('a NEW shown list that republishes the same ids rewrites nothing', () => {
  const b = banc([0, 1, 2, 3, 4]);
  assert.equal(b.adopter.adopt(), true);
  const contenu = [...b.shown];
  // That is the still-pose case: the GPU yields a shown list per frame, and that shown list is
  // the same. A different object carrying the same id sequence does not change the image by a pixel.
  for (let image = 0; image < 3; image++) {
    b.montre({
      uniforms: b.cut.uniforms,
      result: {
        pageIds: [0, 1, 2, 3, 4],
        drawablePageIds: [0, 1, 2, 3, 4],
        frustumRejected: 0,
        lodLevel: 0,
      },
    } as GpuCut);
    assert.equal(b.adopter.adopt(), true, 'the shown list is adopted');
    assert.equal(
      b.adopter.metrics.listsRewritten,
      false,
      'an identical shown list rewrites no list: the held-frame witness must survive',
    );
    assert.equal(b.adopter.metrics.cutHeld, true);
    assert.deepEqual(b.shown, contenu, 'and the displayed list is the same');
  }
});

test('a drawable sequence that would repeat an id displays it only once', () => {
  // Kernel compaction writes strictly increasing ranks, hence without a duplicate: each live page
  // is visited once and its rank is that of its own prefix sum. The displayed list is now the one
  // the difference writes, which dedups by epoch mark — a damaged shown list therefore yields a
  // page once and not twice, where the second pass used to copy it.
  const b = banc([0, 1, 2]);
  b.montre({
    uniforms: b.cut.uniforms,
    result: { pageIds: [0, 1], drawablePageIds: [0, 1, 1, 0], frustumRejected: 0, lodLevel: 0 },
  } as GpuCut);
  assert.equal(b.adopter.adopt(), true);
  assert.deepEqual(
    b.shown.map((page) => page.url),
    ['p0', 'p1'],
  );
  assert.equal(b.adopter.metrics.drawnTriangles, 1 + 2, 'and the totals count it once');
});
