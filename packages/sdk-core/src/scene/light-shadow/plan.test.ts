// The virtual shadow scheduler end to end: what the shading reads is mapped and drawn, what nobody
// reads costs nothing, what moves stales only the pages it covers, and a light that leaves gives
// its pages back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { PAGE_MAPPED, PAGE_VALID } from './virtual.ts';
import { STALE_DYNAMIC, STALE_FULL } from './pool.ts';
import { SUN, VIEW, cycle, lampPages, planFrame, report, sunPages } from './lightShadow.fixture.ts';

/** A sun, planned once so its slice and clipmap exist; returns what the tests read it by. */
function sunScene() {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0),
    level = plan.sun.finest[slice] + 4;
  const pages = sunPages(plan, slice, level, [
    [0, 0],
    [1, 0],
    [0, 1],
  ]);
  return { store, plan, slice, level, pages };
}

test('the pages the shading reads are mapped and drawn the frame their report comes back', () => {
  const { store, plan, pages } = sunScene();
  report(plan, store, 0, pages);
  assert.equal(planFrame(plan, store, 1), 3, 'three pages admitted');
  for (const entry of pages) assert.equal(plan.table.words[entry] & PAGE_VALID, 0, 'not before');
  plan.commit();
  for (const entry of pages) assert.ok(plan.table.words[entry] & PAGE_VALID, 'readable once drawn');
  assert.equal(plan.counts.poolPages, 3);
});

test('a page nobody reads is never drawn, and a still scene draws nothing', () => {
  const { store, plan, pages } = sunScene();
  let frame = 1;
  cycle(plan, store, frame++, () => pages);
  for (let i = 0; i < 3; i++)
    assert.equal(
      cycle(plan, store, frame++, () => pages),
      i ? 0 : 3,
    );
  assert.equal(plan.counts.pendingPages, 0);
  assert.equal(plan.counts.cachedPages, 3, 'read straight from the pool');
  assert.equal(plan.settled(store), true, 'a report proves the image reads only drawn pages');
  // The image now reads one page: a moving object stales all three, only that one is drawn.
  cycle(plan, store, frame++, () => pages.slice(0, 1));
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  assert.equal(
    cycle(plan, store, frame, () => pages.slice(0, 1)),
    1,
  );
  assert.equal(plan.counts.invalidatedPages, 3);
});

test('an object that moves stales only the mapped pages its box covers', () => {
  const { store, plan, slice, level, pages } = sunScene();
  let frame = 1;
  for (; frame < 4; frame++) cycle(plan, store, frame, () => pages);
  // The first page's square, shrunk inside it: its neighbours stay current.
  const metres = 128 * 2 ** level,
    f = slice * 9;
  const right = plan.sun.frame.subarray(f, f + 3),
    up = plan.sun.frame.subarray(f + 3, f + 6);
  const at = (u: number, v: number, h: number) =>
    [0, 1, 2].map((a) => right[a] * u + up[a] * v + h * (a === 1 ? 1 : 0));
  plan.worldChanged(at(0.25 * metres, -0.75 * metres, 0), at(0.75 * metres, -0.25 * metres, 1));
  planFrame(plan, store, frame);
  assert.equal(plan.counts.invalidatedPages, 1);
});

test('a light removed gives its pages back to the pool and its range back to the table', () => {
  const { store, plan, slice, pages } = sunScene();
  cycle(plan, store, 1, () => pages);
  cycle(plan, store, 2, () => pages);
  store.remove(SUN.id);
  planFrame(plan, store, 3);
  assert.equal(plan.pool.used, 0);
  assert.equal(plan.table.baseOf(slice), -1);
  for (const entry of pages) assert.equal(plan.table.words[entry], 0);
});

test('coarse pages are served first, and a full pool evicts only pages no report still names', () => {
  const store = createSceneLightStore();
  const plan = createShadowPlan(24, 32);
  store.add({ ...SUN, kind: 'point', position: [0, 3, 0], range: 20, direction: undefined });
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  // Face 0 at mip 0 is 1024 pages, face 1 at mip 1 is 256: together more than the pool.
  const fine = lampPages(plan, slice, 0, 0),
    coarse = lampPages(plan, slice, 1, 1);
  report(plan, store, 0, [...fine, ...coarse]);
  planFrame(plan, store, 1);
  const mapped = (entries: number[]) =>
    entries.filter((e) => plan.table.words[e] & PAGE_MAPPED).length;
  assert.equal(mapped(coarse), coarse.length, 'every coarse page');
  const pages = plan.pool.pages;
  assert.equal(mapped(fine), pages - coarse.length, 'the fine ones, as far as the pool goes');
  assert.equal(plan.requests.counts.refused, fine.length + coarse.length - pages);
  // A report names a third face: among pages of the same age, the fine ones are evicted first.
  report(plan, store, 1, lampPages(plan, slice, 2, 1));
  planFrame(plan, store, 2);
  assert.equal(mapped(coarse), coarse.length, 'the coarse pages the fine ones fall back to stay');
  assert.equal(mapped(lampPages(plan, slice, 2, 1)), 256);
  // The fine face asked again takes the pool back from the third face, which no later report named.
  report(plan, store, 2, fine);
  planFrame(plan, store, 3);
  assert.equal(mapped(lampPages(plan, slice, 2, 1)), 0);
});

test('a camera that moves by whole pages unmaps the sun pages that leave the clipmap', () => {
  const { store, plan, slice, level, pages } = sunScene();
  cycle(plan, store, 1, () => pages);
  const far: typeof VIEW = {
    ...VIEW,
    position: [VIEW.position[0] + 1e5, VIEW.position[1], VIEW.position[2]],
  };
  planFrame(plan, store, 2, far);
  assert.equal(plan.pool.used, 0, `level ${level} of slice ${slice} no longer holds them`);
});

test('an object already moving stales only the moving casters of the pages it crosses', () => {
  const { store, plan, pages } = sunScene();
  cycle(plan, store, 1, () => pages);
  cycle(plan, store, 2, () => pages);
  const page = plan.table.words[pages[0]] & 0xffff;
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6], true);
  planFrame(plan, store, 3);
  assert.equal(plan.pool.dirty[page], STALE_DYNAMIC);
  plan.worldChanged([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6]);
  planFrame(plan, store, 4);
  assert.equal(plan.pool.dirty[page], STALE_FULL, 'a static change raises it to full');
});
