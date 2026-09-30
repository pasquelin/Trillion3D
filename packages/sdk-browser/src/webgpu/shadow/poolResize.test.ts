// #1208, #1345: the shadow pool follows the scene's demand at runtime — by the reports' pages and
// the grant, every capacity after it, every page it keeps moved texel for texel, and a refusal
// keeping the pool in place, said by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_INDEX_MASK } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  planFrame,
  report,
  sunFloor,
  sunPages,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { frameBatchCapacity } from '../pages/render/frameBatchCapacity.ts';
import { shadowBatchCapacity } from '../../gpu/shadow/batchBudget.ts';
import { MAX_SHADOW_PAGES } from '../../gpu/shadow/recordPack.ts';
import { shadowPageMoves } from '../../gpu/shadow/pageMoveWords.ts';
import { shadowRequestBytes } from './pageRequests.ts';
import { session } from './poolResize.fixture.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { SHRINK_REPORTS } from '../../../../sdk-core/src/scene/light-shadow/poolShrink.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/shadowBudgetBytes.ts';

test('a demand larger then smaller re-sizes the pool, and every capacity follows it', async () => {
  const s = await session();
  const shape = () => [
    s.lights.plan.pool.side,
    s.lights.plan.pool.layers,
    s.lights.plan.pool.pages,
  ];
  const follows = (pages: number) => {
    const { pool, admission } = s.lights.plan;
    assert.equal(pool.pages, pages);
    assert.equal(admission.list.length, pages, 'the admission lists the pool');
    assert.equal(s.lights.pageRequests!.bytes, shadowRequestBytes(pages), 'the request list');
    assert.deepEqual(frameBatchCapacity(s.rt), {
      views: MAX_SHADOW_PAGES,
      ...shadowBatchCapacity(pages, MAX_SHADOW_PAGES, 2 ** 28),
    });
    assert.deepEqual(s.texture()!.size, [pool.side * 128, pool.side * 128, pool.layers]);
  };
  assert.deepEqual(shape(), [16, 1, 256], 'the seed, before any report');
  follows(256);
  const first = s.texture()!;
  // A thousand pages and their floor asked of 256: twice and a half, 51² held.
  await s.ask(1000);
  assert.deepEqual(shape(), [51, 1, 2601]);
  follows(2601);
  assert.equal(first.destroyed, true, 'the old pool is freed once its pages are copied');
  await s.ask(2000);
  assert.deepEqual(shape(), [51, 2, 5202], 'two layers of 51² on a device 8 192 wide');
  follows(5202);
  assert.equal(frameBatchCapacity(s.rt).batches > 109, true, 'more pages, more batches a frame');
  // A demand that fits a pool half as large, report after report of a moving view, gives the
  // memory back.
  for (let i = 1; i < SHRINK_REPORTS; i++) await s.ask(50, true);
  assert.equal(s.lights.plan.pool.pages, 5202, 'not before the reports in a row');
  await s.ask(50, true);
  assert.deepEqual(shape(), [16, 1, 256], 'down to what the reports asked, the seed at least');
  follows(256);
  assert.deepEqual(
    s.said.filter(([p]) => p === 'shadow-pool').map(([, c]) => c.side),
    [51, 51, 16],
  );
  await s.ask(100);
  assert.equal(s.lights.plan.pool.pages, 256, 'a demand the pool holds keeps it');
  s.rt.capture.capturing = true;
  await s.ask(2000);
  assert.equal(s.lights.plan.pool.pages, 256, 'a capture resizes nothing');
});

test('pages requested before and after the resize keep their content: none is drawn again', async () => {
  const s = await session(true),
    { plan, store } = s.lights;
  let extra: number[] = [];
  const slice = () => store.sliceOf(0),
    read = () => [
      ...sunPages(plan, slice(), plan.sun.finest[slice()] + 4, [
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
      sunFloor(plan, slice()),
      ...extra,
    ];
  const cycle = (frame: number) => {
    const drawn = planFrame(plan, store, frame);
    plan.commit();
    report(plan, store, frame, read());
    return drawn;
  };
  for (let frame = 0; frame < 4; frame++) cycle(s.base + frame);
  // A report asks 150 pages more: past half the seed, the pool grows once they are drawn.
  extra = Array.from({ length: 150 }, (_, i) =>
    sunPages(plan, slice(), plan.sun.finest[slice()] + 6, [[(i % 15) - 7, Math.floor(i / 15) - 5]]),
  ).flat();
  cycle(s.base + 4);
  cycle(s.base + 5);
  const entries = read(),
    before = entries.map((entry) => plan.table.words[entry]),
    mapped = new Map<number, number>();
  for (let page = 0; page < plan.pool.pages; page++)
    if (plan.pool.owner[page] >= 0) mapped.set(page, plan.pool.owner[page]);
  assert.ok(
    before.every((word) => word !== 0),
    'every page read is mapped and drawn',
  );
  await s.follow();
  const side = plan.pool.side;
  assert.ok(side > 16, `the pool grew: ${side}`);
  const after = entries.map((entry) => plan.table.words[entry]);
  assert.deepEqual(
    after.map((word) => word & ~PAGE_INDEX_MASK),
    before.map((word) => word & ~PAGE_INDEX_MASK),
    'each entry still reads a current page',
  );
  // The GPU was handed one move per page kept, from its old place to the one the table names.
  const moved = new Int32Array(256).fill(-1);
  for (const [page, entry] of mapped.entries())
    moved[page] = plan.table.words[entry] & PAGE_INDEX_MASK;
  const depth = shadowPageMoves(moved, 16, side),
    half = shadowPageMoves(moved, 16, side, 0.5);
  assert.deepEqual([...s.gpu.moves[0]].sort(), [...depth].sort(), 'the pool pages');
  assert.deepEqual([...s.gpu.moves[1]].sort(), [...half].sort(), 'their translucent depth');
  assert.equal(s.gpu.copies.length, mapped.size, 'and their transmittance, one copy each');
  assert.deepEqual(
    s.gpu.passes.map(([layer]) => layer),
    [0, 0],
    'one pass per target layer',
  );
  assert.equal(cycle(s.base + 6), 0, 'the frame after the resize draws no page again');
  assert.equal(cycle(s.base + 7), 0);
});

test('a refused grant keeps the old pool and says so', async () => {
  const s = await session();
  const held = s.texture(),
    pages = s.lights.plan.pool.pages;
  s.limit.bytes = 0;
  await s.ask(1000);
  assert.equal(s.texture(), held, 'the pool in place is kept');
  assert.equal(held!.destroyed, false);
  assert.equal(s.lights.plan.pool.pages, pages, 'and the plan pages it still');
  const [phase, context] = s.said.at(-1)!;
  assert.equal(phase, 'gpu-out-of-memory', 'said by the existing diagnostic');
  assert.equal(context.pool, 'shadow');
  assert.equal(context.grantedBytes, null);
  assert.equal(s.lights.shadowReason, null, 'shadows stay on');
  assert.equal(s.said.filter(([name]) => name === 'shadows-off').length, 0);
  const told = s.said.length;
  await s.ask(1000);
  assert.equal(s.said.length, told, 'asked once per size, not every report');
  s.limit.bytes = Infinity;
  await s.ask(1500);
  assert.equal(s.lights.plan.pool.pages, 3844, 'the next size is asked again');
});

test('a transmittance layer the resized pool cannot get keeps the old pool, said by name', async () => {
  const s = await session(true);
  const held = s.texture();
  // Room for the resized pool, not for a layer of 8 192² texels in two layers.
  s.limit.bytes = 400 * 2 ** 20;
  await s.ask(1000);
  assert.equal(s.texture(), held, 'the pool in place is kept');
  assert.equal(s.lights.plan.pool.pages, 256);
  const [phase, context] = s.said.at(-1)!;
  assert.deepEqual(
    [phase, context.pool, context.grantedBytes],
    ['gpu-out-of-memory', 'shadow-transmittance', null],
  );
});

test('a pool the device halves below the one in place is not taken: the pool in place stays', async () => {
  const s = await session();
  const held = s.texture();
  // A pool of 20² asked, the device halves it below the 16² in place.
  s.limit.bytes = shadowAtlasBytes(14);
  await s.ask(150);
  assert.equal(s.texture(), held);
  assert.equal(s.lights.plan.pool.pages, 256);
});

test('a transmittance layer past the shadow grant keeps the pool in place, said by name', async () => {
  const s = await session(true);
  const held = s.texture();
  Object.assign(s.lights.pageRequests!, { bytes: SHADOW_GRANT_BYTES });
  await s.ask(1000);
  assert.equal(s.texture(), held);
  const [phase, context] = s.said.at(-1)!;
  assert.deepEqual([phase, context.pressure], ['shadow-memory', 'transmittance-over-grant']);
});
