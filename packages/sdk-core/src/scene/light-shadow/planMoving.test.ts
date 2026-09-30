// Shadow pages while the camera moves: a frame with no report of its own evicts nothing the
// latest report named (#26).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_MAPPED } from './virtual.ts';
import { SUN, lampPages, nudged, planFrame, report } from './lightShadow.fixture.ts';

test('moving, a frame with no report keeps what the latest report named from a new lamp', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(4);
  store.add({ ...SUN, id: 'a', kind: 'point', position: [0, 3, 0], range: 20 });
  planFrame(plan, store, 0, nudged(0));
  const fine = lampPages(plan, store.sliceOf(0), 0, 2);
  report(plan, store, 0, fine);
  planFrame(plan, store, 1, nudged(1));
  assert.equal(plan.pool.used(), plan.pool.pages, 'the report fills the pool');
  const mapped = () => fine.filter((e) => plan.table.words[e] & PAGE_MAPPED).length,
    held = mapped();
  // A lamp posed while the camera moves, on a frame whose report has not landed: its floors take
  // no page the latest report named, as the report's own frame would not have given them (#26).
  store.add({ ...SUN, id: 'b', kind: 'point', position: [5, 3, 0], range: 20 });
  planFrame(plan, store, 2, nudged(2));
  assert.equal(mapped(), held, 'the pages the view still reads stay');
});
