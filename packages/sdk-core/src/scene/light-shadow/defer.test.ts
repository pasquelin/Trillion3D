// A representation change — level of detail, residency, colour tile — waits for the camera to
// rest before it stales shadow pages; a world change stales them at once. Under a moving camera
// the cut churns every frame, and each churn would restale every page it covers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nudged, planFrame, settledSun } from './lightShadow.fixture.ts';
import { STALE_DYNAMIC, STALE_FULL } from './pool.ts';

const BOX_MIN = [-1e3, 0, -1e3],
  BOX_MAX = [1e3, 2, 1e3];

/** A sun whose pages around the eye are all mapped and drawn. */
function settled() {
  const { store, plan, frame, read } = settledSun();
  assert.equal(plan.counts.pendingPages, 0);
  return { store, plan, frame, page: plan.table.words[read()[0]] & 0xffff };
}

test('a representation change under a moving camera stales nothing until the camera rests', () => {
  const { store, plan, frame } = settled();
  for (let i = 0; i < 4; i++) {
    plan.representationChanged(BOX_MIN, BOX_MAX);
    planFrame(plan, store, frame + i, nudged(i + 1));
    assert.equal(plan.counts.invalidatedPages, 0, `frame ${i}: the change waits`);
    assert.equal(plan.deferredChanges, true);
  }
  // The same view twice: the camera rests, and the union of what changed enters the list.
  planFrame(plan, store, frame + 4, nudged(4));
  assert.ok(plan.counts.invalidatedPages > 0, 'the deferred box stales its pages');
  assert.equal(plan.deferredChanges, false);
});

test('a world change stales its pages at once, camera moving or not', () => {
  const { store, plan, frame } = settled();
  plan.worldChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame, nudged(1));
  assert.ok(plan.counts.invalidatedPages > 0);
});

test('a representation change under a still camera stales its pages on the next frame', () => {
  const { store, plan, frame } = settled();
  plan.representationChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame);
  assert.ok(plan.counts.invalidatedPages > 0);
  assert.equal(plan.deferredChanges, false);
});

// #993: the static layer never held an object already moving; its change of detail keeps that layer.
test('a representation change of objects already moving waits too, then stales their moving casters alone', () => {
  const { store, plan, frame, page } = settled();
  plan.representationChanged(BOX_MIN, BOX_MAX, true);
  planFrame(plan, store, frame, nudged(1));
  assert.equal(plan.counts.invalidatedPages, 0, 'the change waits');
  planFrame(plan, store, frame + 1, nudged(1));
  assert.equal(plan.pool.dirty[page], STALE_DYNAMIC, 'released at rest, the static layer kept');
  plan.representationChanged(BOX_MIN, BOX_MAX, true);
  plan.representationChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame + 2, nudged(1));
  assert.equal(plan.pool.dirty[page], STALE_FULL, 'a still object beside raises it to full');
});

// #831: a page kept with a superseded form of its caster shades the form the camera now draws.
test('a residency change stales its pages at once under a moving camera, still read until redrawn', () => {
  const { store, plan, frame, page } = settled();
  plan.residencyChanged(BOX_MIN, BOX_MAX);
  planFrame(plan, store, frame, nudged(1));
  assert.ok(plan.counts.invalidatedPages > 0, 'the moving camera does not hold it back');
  assert.equal(plan.pool.dirty[page], STALE_FULL);
  assert.equal(plan.pool.valid[page], 1, 'a change of detail is read until its redraw');
  assert.equal(plan.deferredChanges, false, 'nothing waits for the camera to rest');
});

// #831: the clusters a stream brings in together overlap: one box, projected once, never a far
// one joined to them, which would stale every page between.
test('overlapping residency changes merge into one box, a far one stays apart', () => {
  const { plan } = settled(),
    room = plan.changeRoom();
  plan.residencyChanged([0, 0, 0], [2, 1, 2]);
  plan.residencyChanged([1, 0, 1], [3, 1, 3]);
  assert.equal(plan.changeRoom(), room - 1, 'two overlapping clusters: one box');
  plan.residencyChanged([40, 0, 40], [41, 1, 41]);
  assert.equal(plan.changeRoom(), room - 2, 'a far one apart');
  plan.residencyChanged([40, 0, 40], [41, 1, 41], true);
  assert.equal(plan.changeRoom(), room - 3, 'a moving one, of another kind, apart');
});
