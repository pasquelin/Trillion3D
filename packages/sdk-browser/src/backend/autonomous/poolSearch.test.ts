// The WebGL2 pool's threshold search at its bounds: a budget not even the root cover fits, and
// the ancestors a refinement holds beside the pages replacing them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dagLevels } from '../../../../../bench/perf/browser/support/dagCut.ts';
import { PAGE } from './pool.fixture.ts';
import { fileURLToPath } from 'node:url';
import { mount } from './poolCut.fixture.ts';
import { publicScene } from '../../../../../bench/perf/browser/support/publicScene.ts';

/** A public scene's cache, from this file. */
const SCENE = '../../../../../site/assets/gallery/signature-architecture/cache/native/full';

/** The most the zoom below held above its 150 slots (`docs/ENGINE.md`). */
const TRANSIENT_SLOTS = 11;

test('a budget not even the root cover fits holds the threshold at the root cover', () => {
  const { pool, image, rootCoverAt, drawn } = mount(1000 * PAGE, { rootCharged: true });
  for (let frame = 0; frame < 12; frame++) image(1);
  const fine = drawn();
  pool.resize(PAGE);
  const thresholds: number[] = [];
  for (let frame = 0; frame < 40; frame++) {
    image(1);
    thresholds.push(pool.budgetPixelError);
  }
  const top = Math.max(...thresholds);
  // The search climbs the √2 ladder in the image the budget drops, and stops at the first step
  // whose cut overflows on the root page alone: every coarser step overflows as well.
  assert.equal(top, rootCoverAt(), 'the threshold stops at the root cover');
  assert.ok(
    thresholds.every((threshold) => threshold === top),
    'and does not move from one image to the next',
  );
  assert.equal(pool.settling, false, 'nothing finer is left to try');
  assert.equal(pool.coverageBudgetLimited, true);
  // A larger budget: one step of √2 finer an image, down to the host's threshold.
  pool.resize(400 * PAGE);
  let images = 0;
  do image(1);
  while ((pool.settling || pool.budgetPixelError > 0) && ++images < 64);
  assert.ok(images <= 2 * Math.log2(top) + 2, `${images} images back from ${top}`);
  assert.equal(pool.budgetPixelError, 0);
  for (let frame = 0; frame < 12; frame++) image(1);
  assert.equal(drawn(), fine, 'the detail the host asked for is back');
});

test('a refinement holds the ancestors it replaces beside their pages, then comes back under the pool', () => {
  // The camera closes in from 72 units to 9: the cut asks for the top page, then 60 coarse pages,
  // then 100 fine ones, all streamed eight an image. Until the last of a level arrives, the level
  // above stands in for it (the fallback), and stays resident beside the pages that replace it.
  const { pool, image, frame, place } = mount(150 * PAGE, {
    pages: dagLevels(100, 60, { coarseResident: false }),
    rootFallback: true,
  });
  const slots = pool.held.slots;
  let peak = 0,
    metricAbove = 0;
  for (let step = 0; step <= 40; step++) {
    place(Math.max(9, 72 - step * 3));
    const most = image(1, 8);
    peak = Math.max(peak, most);
    // Past the pool only by the ancestors standing in, both between images and in the frame
    // metrics (`geometryPoolAllocatedBytes`, read once the image trimmed).
    assert.ok(most <= (slots + frame.stand) * PAGE, `step ${step}: ${most / PAGE} pages at most`);
    assert.ok(frame.after <= (slots + frame.stand) * PAGE, `step ${step}: ${frame.after / PAGE}`);
    if (frame.stand === 0) assert.ok(frame.after <= slots * PAGE, `step ${step}: back under`);
    if (frame.after > slots * PAGE) metricAbove++;
  }
  assert.equal(frame.stand, 0, 'every page arrived');
  assert.equal(pool.budgetPixelError, 0, 'the fine cut fits the pool on its own');
  assert.ok(frame.after <= slots * PAGE, `${frame.after / PAGE} pages for ${slots} slots`);
  // The peak: 100 fine pages, the 60 coarse ones they replace and the top page, for 150 slots.
  assert.equal(
    peak / PAGE - slots,
    TRANSIENT_SLOTS,
    `peak ${peak / PAGE} pages for ${slots} slots`,
  );
  assert.ok(metricAbove > 0, 'the frame metrics show it');
});

test('a public scene whose coarsest cut overflows a small pool holds the threshold, and lets it go', () => {
  // Seen from inside its bounds, the scene refines pages whose parent reaches the near plane at
  // every threshold: at 256 KiB, no threshold brings its cut under the 34 slots.
  const scene = publicScene(fileURLToPath(new URL(SCENE, import.meta.url)));
  const { pool, image, frame, drawn } = mount(512 * 1024 * 1024, { ...scene, rootFallback: true });
  const sequence = (bytes: number, images = 16) => {
    pool.resize(bytes);
    const thresholds: number[] = [];
    for (let frame = 0; frame < images; frame++) {
      image(1, 16);
      thresholds.push(pool.budgetPixelError);
    }
    return thresholds;
  };
  assert.ok(sequence(512 * 1024 * 1024).every((threshold) => threshold === 0));
  // The cut at the host's threshold, streamed in full: no ancestor stands in for its pages.
  for (let images = 0; frame.stand && images < 64; images++) image(1, 16);
  assert.equal(frame.stand, 0, "the cut at the host's threshold arrived");
  // The pool that holds it: a slot of the largest page for each page it draws and each root page.
  const pages = scene.primitives.flat(),
    largest = Math.max(...pages.map((page) => scene.bytes(page.url))),
    roots = pages.filter((page) => page.parentError == null).length,
    fits = (drawn() + roots) * largest;
  const small = sequence(256 * 1024),
    top = small[0];
  assert.ok(top > 1 && small.every((threshold) => threshold === top), `${small}`);
  assert.equal(pool.clamp, 'root-cover', 'limited by what no threshold coarsens');
  assert.equal(pool.settling, false, 'the search is fixed');
  // A larger pool: one step of √2 finer an image, down to the host's threshold.
  const back = sequence(fits, 2 * Math.log2(top) + 2);
  const settled = back.indexOf(0);
  assert.ok(settled > 0, `back at the host's threshold: ${back}`);
  for (let frame = 1; frame < settled; frame++)
    assert.equal(back[frame], back[frame - 1] / Math.SQRT2, `${back}`);
  assert.equal(pool.clamp, null);
});
