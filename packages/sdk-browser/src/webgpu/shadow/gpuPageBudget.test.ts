// #831: the GPU maps at most a frame's page budget. A burst — a scene's first frame, a camera cut —
// mapped and drew every page it asked at once, 2 423 pages and 286 ms of GPU in one frame; past
// the budget a need stays unmapped, reads the coarser page, and is mapped the next frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN, VIEW } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import type { ShadowRequestReport } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';
import { SHADOW_PAGES_PER_FRAME } from '../../gpu/shadow/batchBudget.ts';
import { gpuFrames } from './gpuFrames.fixture.ts';
import { floorTiles, tileGrid } from './shadingReads.fixture.ts';
import { POOL_COUNTS } from './poolWgsl.ts';

const { lits } = floorTiles(tileGrid(-40, 40, -80, 0), 2);

test('the GPU maps at most the page budget a frame, the rest the next frames, none refused', async () => {
  const run = gpuFrames(48, [SUN]),
    { plan, owner } = run,
    inbox: ShadowRequestReport[] = [];
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
  assert.ok(first.read > SHADOW_PAGES_PER_FRAME, `${first.read} pages read, past the budget`);
  assert.ok(
    first.allocated === SHADOW_PAGES_PER_FRAME,
    `${first.allocated} pages mapped in one frame`,
  );
  assert.equal(run.refused(), 0, 'a need past the budget is no memory refusal');
  const second = await frame(2);
  assert.ok(second.mapped > first.mapped, 'the next frame maps the rest');
});
