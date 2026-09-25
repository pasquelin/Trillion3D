// #489: every page a frame marks is listed in that frame, and a frame whose budget holds its list —
// always at rest (#525) — draws it whole: no coarse or stale page stands in for it. Each frame,
// every page the latest report named is current: mapped to its very level and absolute page,
// drawn, stale for nothing — what the converged pose holds.
// The report comes back one frame late (`cycleDrawn`); the frame that reads it marks and draws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLightStore } from '../light/store.ts';
import { createShadowPlan } from './plan.ts';
import { sunPageMetres } from './virtual.ts';
import { SUN, VIEW, cycleDrawn, planFrame } from './lightShadow.fixture.ts';
import { covers, currentPage, entriesOf, sunBlock, type SunPage } from './sunView.fixture.ts';

/** A sun over the fixture scene, planned once, and three levels of `side²` pages it reads. */
function sunScene(side = 8) {
  const store = createSceneLightStore();
  const plan = createShadowPlan(32);
  store.add(SUN);
  planFrame(plan, store, 0);
  const slice = store.sliceOf(0);
  const read = (at: ArrayLike<number> = VIEW.position) =>
    sunBlock(plan, slice, [2, 3, 4], at, side);
  return { store, plan, slice, read };
}

/** Asserts every page of `pages` is current; returns their physical pages. */
function assertCurrent(
  plan: ReturnType<typeof createShadowPlan>,
  slice: number,
  pages: SunPage[],
  at: string,
) {
  return pages.map((page) => {
    const phys = currentPage(plan, slice, page);
    assert.ok(phys >= 0, `${at}: page ${page.level}/${page.ax},${page.ay} is not current`);
    return phys;
  });
}

test('a camera sweep: each frame reads current pages, and draws only the pages entering', () => {
  const { store, plan, slice, read } = sunScene(6);
  const step = sunPageMetres(plan.sun.finest[slice] + 2);
  const eye = (frame: number) => [(frame - 1) * step, 5, 0] as const;
  let named = read(eye(1));
  cycleDrawn(plan, store, 1, () => entriesOf(plan, slice, named), VIEW);
  for (let frame = 2; frame < 24; frame++) {
    const view = { ...VIEW, position: eye(frame) },
      mapped = new Set<number>();
    for (let page = 0; page < plan.pool.pages; page++)
      if (plan.pool.owner[page] >= 0 && plan.pool.valid[page]) mapped.add(page);
    const next = read(eye(frame));
    const drawn = cycleDrawn(plan, store, frame, () => entriesOf(plan, slice, next), view);
    assertCurrent(plan, slice, named, `frame ${frame}`);
    for (const page of drawn)
      assert.ok(!mapped.has(page), `frame ${frame}: page ${page} was current and drawn again`);
    named = next;
  }
});

test('a caster moving every frame redraws its old and new bounds in the frame of the move', () => {
  const { store, plan, slice, read } = sunScene();
  const named = read();
  for (let frame = 1; frame < 4; frame++)
    cycleDrawn(plan, store, frame, () => entriesOf(plan, slice, named));
  const size = 0.4,
    at = (frame: number) => -0.3 + frame * 0.02;
  for (let frame = 4; frame < 20; frame++) {
    // The union of where it was and where it is, as a placement declares it (`followPlacementRows`).
    const min = [at(frame - 1), 1, -size / 2],
      max = [at(frame) + size, 1 + size, size / 2];
    plan.worldChanged(min, max, frame > 4);
    const drawn = cycleDrawn(plan, store, frame, () => entriesOf(plan, slice, named));
    const pages = assertCurrent(plan, slice, named, `frame ${frame}`);
    const under = named.filter((page) => covers(plan, slice, page, min, max));
    assert.ok(under.length > 24, `the caster covers ${under.length} pages read`);
    for (const page of under)
      assert.ok(drawn.has(pages[named.indexOf(page)]), `frame ${frame}: a page under it waits`);
  }
});

test('casters created and freed every frame leave no page holding a freed caster', () => {
  const { store, plan, slice, read } = sunScene();
  const named = read();
  for (let frame = 1; frame < 4; frame++)
    cycleDrawn(plan, store, frame, () => entriesOf(plan, slice, named));
  const box = (k: number) => {
    const x = ((k * 37) % 9) / 10 - 0.45,
      z = ((k * 53) % 9) / 10 - 0.45;
    return { min: [x, 0.5, z], max: [x + 0.12, 0.7, z + 0.12] };
  };
  for (let frame = 4; frame < 20; frame++) {
    const freed = [0, 1, 2, 3].map((k) => box(frame * 4 + k - 4)),
      made = [0, 1, 2, 3].map((k) => box(frame * 4 + k));
    for (const { min, max } of [...freed, ...made]) plan.worldChanged(min, max, true);
    const drawn = cycleDrawn(plan, store, frame, () => entriesOf(plan, slice, named));
    const pages = assertCurrent(plan, slice, named, `frame ${frame}`);
    for (const { min, max } of freed)
      for (const [k, page] of named.entries())
        if (covers(plan, slice, page, min, max))
          assert.ok(drawn.has(pages[k]), `frame ${frame}: a page keeps a freed caster`);
  }
});

test('a still camera under still lights draws nothing once the frame that reads converges', () => {
  const { store, plan, slice, read } = sunScene();
  const named = read();
  cycleDrawn(plan, store, 1, () => entriesOf(plan, slice, named));
  const first = cycleDrawn(plan, store, 2, () => entriesOf(plan, slice, named));
  assert.ok(first.size > 24, `the first frame that reads draws its ${first.size} pages`);
  assertCurrent(plan, slice, named, 'frame 2');
  for (let frame = 3; frame < 12; frame++)
    assert.equal(cycleDrawn(plan, store, frame, () => entriesOf(plan, slice, named)).size, 0);
  assert.equal(plan.counts.pendingPages, 0);
});
