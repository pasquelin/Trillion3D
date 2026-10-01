// #831: 128 restore copies a frame for two small moving cars. A moving caster restores only the
// pages its box touches at the levels where it spans a texel: at a level whose texel is wider than
// its box, the cull draws it into no page (`underTexel`, `cullShader.ts`), so its moves stale none
// there. A still caster that moves stales them all: the static layer held it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN_LEVELS } from './virtual.ts';
import { PAGES, sunPageMetres } from './pageModel.ts';
import { STALE_BY } from './counts.ts';
import { cycle, planFrame, staleEntries, sunPages, sunScene } from './lightShadow.fixture.ts';

/** Half the caster's side on the light plane, and its height, in metres: a wheel's size. */
const HALF = 0.15,
  HEIGHT = 0.3;

/** A sun scene whose page under the caster is drawn at every level from the fourth above the
 *  finest; the caster's box as it moves, and each level's page entry under it. */
function settled() {
  const { store, plan, slice } = sunScene(),
    finest = plan.sun.finest[slice],
    levels = Array.from({ length: SUN_LEVELS - 4 }, (_, i) => finest + 4 + i);
  // The caster's centre on both light-plane axes: a third of the coarsest level's half texel off
  // its samples (`pageRects.ts`), as `moverTexels.test.ts` places it.
  const c = sunPageMetres(levels[levels.length - 1]) / 128 / 6,
    f = slice * 9,
    right = plan.sun.frame.subarray(f, f + 3),
    up = plan.sun.frame.subarray(f + 3, f + 6);
  // The light plane's `v` runs against `up` (`sunBoxRect`).
  const at = (u: number, v: number, h: number) =>
    [0, 1, 2].map((a) => right[a] * u - up[a] * v + h * (a === 1 ? 1 : 0));
  const corners = [at(c - HALF, c - HALF, 0), at(c + HALF, c + HALF, HEIGHT)],
    min = [0, 1, 2].map((a) => Math.min(corners[0][a], corners[1][a])),
    max = [0, 1, 2].map((a) => Math.max(corners[0][a], corners[1][a]));
  const entryOf = (level: number) => {
    const page = Math.floor(c / sunPageMetres(level));
    return sunPages(plan, slice, level, [[page, page]])[0];
  };
  const read = levels.map(entryOf);
  for (let frame = 1; frame < 4; frame++) cycle(plan, store, frame, () => read);
  assert.deepEqual(staleEntries(plan), [], 'every page read is drawn');
  return { store, plan, levels, entryOf, min, max };
}

test('a moving caster stales its pages only at the levels where it spans a texel', () => {
  const { store, plan, levels, entryOf, min, max } = settled(),
    reach = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  plan.worldChanged(min, max, true);
  planFrame(plan, store, 4);
  const spans = levels.filter((level) => reach >= (15 / 16) * PAGES.shadowSunTexelMetres(level));
  assert.ok(spans.length > 2 && spans.length < levels.length - 2, `${spans.length} levels`);
  assert.deepEqual(
    staleEntries(plan),
    spans.map(entryOf).sort((a, b) => a - b),
  );
  assert.equal(plan.counts.staledBy[STALE_BY.moving], spans.length);
});

test('a still caster that moves stales its pages under a texel too, where it holds a sample', () => {
  const moving = settled(),
    still = settled();
  moving.plan.worldChanged(moving.min, moving.max, true);
  planFrame(moving.plan, moving.store, 4);
  still.plan.worldChanged(still.min, still.max);
  planFrame(still.plan, still.store, 4);
  const [spanned, held] = [staleEntries(moving.plan), staleEntries(still.plan)];
  // Its static depth was drawn there: it goes, whatever the texel (`holdsSample`, #1345).
  assert.ok(held.length > spanned.length, `${held.length} pages, ${spanned.length} moving`);
  assert.ok(spanned.every((entry) => held.includes(entry)));
});
