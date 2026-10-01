// #831: a frame fills at most its static fill (`shadowPagesPerFrame`), a sixteenth of the pool — a
// view over eight frames —, never past the grant's batches. Past it a need stays unmapped, or
// mapped and unclaimed, reads the coarser page, and is filled the next frames, the coarsest first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN, VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import type { ShadowRequestReport } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';
import {
  MAX_SHADOW_RUNS,
  SHADOW_FILL_FRAMES,
  shadowPagesPerFrame,
} from '../../gpu/shadow/batchBudget.ts';
import { MAX_SHADOW_PAGES } from '../../gpu/shadow/atlas.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { floorTiles, tileGrid } from './shadingReads.fixture.ts';
import { POOL_COUNTS } from './allocLayout.ts';
import { PAGE_VALID } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

const { lits } = floorTiles(tileGrid(-40, 40, -80, 0), 2),
  { lits: near } = floorTiles(tileGrid(-16, 16, -32, 0), 2);
/** A budget below the burst these views ask, four batches: the grant's holds these whole pools. */
const BUDGET = 4 * MAX_SHADOW_PAGES;

test('the static fill is a view over eight frames, a batch at least, the grant at most', () => {
  assert.equal(shadowPagesPerFrame(2601), Math.ceil(2601 / (2 * SHADOW_FILL_FRAMES)));
  assert.equal(shadowPagesPerFrame(64), MAX_SHADOW_PAGES, 'a batch at least');
  assert.equal(shadowPagesPerFrame(8), 8, 'the pool when smaller');
  assert.equal(shadowPagesPerFrame(64 * MAX_SHADOW_RUNS), MAX_SHADOW_RUNS, 'the grant at most');
  assert.equal(gpuFrames(48, [SUN]).allocation.pagesPerFrame, shadowPagesPerFrame(48 * 48));
});

// #831: the boss's spike, 478 static pages and the GPU's own in one frame (109 ms). A burst of
// newly visible pages — a cold view, every page mapped in its first frame, as a residency change
// over the view withdraws them all — never draws more than the budget a frame: the rest wait,
// listed, the coarsest drawn first, and all are drawn within the frames the budget spreads them over.
test('a burst of newly visible pages never draws more than the budget a frame', async () => {
  const run = gpuFrames(32, [SUN]),
    inbox: ShadowRequestReport[] = [],
    budget = (run.fill = run.allocation.pagesPerFrame),
    rank = run.field('rank');
  run.allocation.pagesPerFrame = run.plan.pool.pages;
  const frame = async (at: number) => {
    for (const report of inbox.splice(0)) run.plan.receive(report);
    const read = await run.frame(at, VIEW, near, (report) => inbox.push(report));
    return read.filter((e) => !(run.table[e] & PAGE_VALID));
  };
  let waiting = await frame(1);
  assert.ok(new Set(waiting).size + run.regions.length > budget, 'a burst past one frame');
  const drawn = [run.regions.length];
  // The first frame's pages are the coarsest of what it listed: none it left is coarser.
  const finest = Math.min(...run.regions.map((p) => rank[p]));
  for (let p = 0; p < rank.length; p++)
    if (run.owner[p] >= 0 && !run.regions.includes(p) && !(run.table[run.owner[p]] & PAGE_VALID))
      assert.ok(rank[p] <= finest, `page ${p} of rank ${rank[p]} left behind a finer one`);
  for (let at = 2; waiting.length && at < 24; at++) {
    waiting = await frame(at);
    drawn.push(run.regions.length);
  }
  assert.ok(Math.max(...drawn) <= budget, `at most ${budget} a frame: ${drawn.join(', ')}`);
  assert.equal(waiting.length, 0, 'every page read is drawn at its own level in the end');
});

test('the GPU maps at most the page budget a frame, the rest the next frames, none refused', async () => {
  const run = gpuFrames(48, [SUN]),
    { plan, owner } = run,
    inbox: ShadowRequestReport[] = [];
  run.allocation.pagesPerFrame = BUDGET;
  const mapped = () => owner.filter((entry) => entry >= 0).length;
  const frame = async (at: number) => {
    for (const report of inbox.splice(0)) plan.receive(report);
    const read = await run.frame(at, VIEW, lits, (report) => inbox.push(report));
    const counts = new Uint32Array(run.field('owner').buffer, 0, POOL_COUNTS.length);
    return {
      read: new Set(read).size,
      mapped: mapped(),
      allocated: counts[POOL_COUNTS.indexOf('allocated')],
    };
  };
  const first = await frame(1);
  assert.ok(first.read > BUDGET, `${first.read} pages read, past the budget`);
  assert.equal(first.allocated, BUDGET, `${first.allocated} pages mapped in one frame`);
  assert.equal(run.refused(), 0, 'a need past the budget is no memory refusal');
  const second = await frame(2);
  assert.ok(second.mapped > first.mapped, 'the next frame maps the rest');
});

// #831: a coarser read past the budget is transient. Once the view holds, every page the shading
// reads is drawn at the level it asked, within the frames the budget spreads the burst over.
test('once the view holds, every page read is drawn at its own level within the budget frames', async () => {
  const run = gpuFrames(32, [SUN]),
    inbox: ShadowRequestReport[] = [];
  run.allocation.pagesPerFrame = BUDGET;
  const frame = async (at: number) => {
    for (const report of inbox.splice(0)) run.plan.receive(report);
    const read = await run.frame(at, VIEW, near, (report) => inbox.push(report));
    return { read: new Set(read).size, coarser: read.filter((e) => !(run.table[e] & PAGE_VALID)) };
  };
  const first = await frame(1);
  assert.ok(first.read > BUDGET, 'a burst past one frame');
  const bound = 2 + Math.ceil(first.read / BUDGET);
  let at = 1,
    coarser = first.coarser.length;
  while (coarser && at < bound) coarser = (await frame(++at)).coarser.length;
  assert.equal(coarser, 0, `${coarser} pages still read at a coarser level after ${at} frames`);
});
