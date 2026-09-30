// #1345: a moving caster stales the pages it overlaps only at the levels where it covers a texel's
// sample: at a level whose texels are wider than it, lying between their samples, it writes none,
// before or after its move, and the page keeps. Every read page is at the caster's own place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN_LEVELS } from './virtual.ts';
import { sunPageMetres } from './pageModel.ts';
import { cycle, planFrame, staleEntries, sunPages, sunScene } from './lightShadow.fixture.ts';

/** Half the caster's side, in metres: a four-centimetre cube. */
const HALF = 0.02;
/** The caster's centre on both light-plane axes: a third of the coarsest level's half texel, so a
 *  third of every level's half texel off its samples (`pageRects.ts`, `holdsSample`). */
const centreOf = (coarsest: number) => sunPageMetres(coarsest) / 128 / 2 / 3;

test('a moving caster stales its own pages only at the levels where it covers texels', () => {
  const { store, plan, slice } = sunScene();
  const finest = plan.sun.finest[slice],
    levels = Array.from({ length: SUN_LEVELS - 4 }, (_, i) => finest + 4 + i),
    c = centreOf(levels[levels.length - 1]);
  const f = slice * 9,
    right = plan.sun.frame.subarray(f, f + 3),
    up = plan.sun.frame.subarray(f + 3, f + 6);
  // The light plane's `v` runs against `up` (`sunBoxRect`): the caster sits at `(c, c)`.
  const at = (u: number, v: number, h: number) =>
    [0, 1, 2].map((a) => right[a] * u - up[a] * v + h * (a === 1 ? 1 : 0));
  const pageOf = (level: number) => {
    const page = Math.floor(c / sunPageMetres(level));
    return sunPages(plan, slice, level, [[page, page]])[0];
  };
  const read = levels.map(pageOf);
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read);
  assert.deepEqual(staleEntries(plan), [], 'every page read is drawn');
  plan.worldChanged(at(c - HALF, c - HALF, 0), at(c + HALF, c + HALF, 1), true);
  planFrame(plan, store, 4);
  // A level holds a sample of the caster when its half texel, less the slack of an eighth of it,
  // is within the caster's reach from its centre: a texel at most 0.19 m wide.
  const covers = (level: number) => {
    const half = sunPageMetres(level) / 128 / 2;
    return half / 3 - half / 8 <= HALF;
  };
  const expected = levels.filter(covers).map(pageOf);
  assert.ok(expected.length >= 6 && expected.length < levels.length - 4, `${expected.length}`);
  assert.deepEqual(
    staleEntries(plan),
    expected.sort((a, b) => a - b),
  );
});
