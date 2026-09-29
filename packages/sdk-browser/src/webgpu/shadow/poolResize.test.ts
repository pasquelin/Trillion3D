// #1208: the shadow pool follows a canvas resize at runtime — by the first frame's rule and grant,
// every capacity after it, every page it keeps moved texel for texel, and a refusal keeping the
// pool in place, said by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_INDEX_MASK } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  SUN,
  planFrame,
  report,
  sunFloor,
  sunPages,
} from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { frameBatchCapacity } from '../pages/render/encodeShadowBatches.ts';
import { shadowBatchCapacity } from '../../gpu/shadow/batchBudget.ts';
import { MAX_SHADOW_PAGES } from '../../gpu/shadow/recordPack.ts';
import { shadowPageMoves } from '../../gpu/shadow/pageMoves.ts';
import { shadowRequestBytes } from './pageRequests.ts';
import { session } from './poolResize.fixture.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';

test('a resize larger then smaller re-sizes the pool, and every capacity follows it', async () => {
  const s = await session([1280, 720]);
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
  assert.deepEqual(shape(), [51, 1, 2601]);
  follows(2601);
  const first = s.texture()!;
  s.lights.store.remove('shadow sun');
  await s.frame(640, 360);
  assert.equal(s.lights.plan.pool.pages, 2601, 'no light casts: nothing asked');
  s.lights.store.add({ ...SUN, id: 'shadow sun' });
  await s.frame(640, 360);
  assert.equal(s.lights.plan.pool.pages, 676, 'a caster back at that size resizes it');
  await s.frame(1280, 720);
  await s.frame(3456, 2234);
  assert.deepEqual(shape(), [51, 2, 5202], 'two layers of 51² on a device 8 192 wide');
  follows(5202);
  assert.equal(s.gpu.moves.length, 0, 'no page mapped: nothing to move, no buffer');
  assert.equal(first.destroyed, true, 'the old pool is freed once its pages are copied');
  assert.equal(frameBatchCapacity(s.rt).batches > 109, true, 'more pages, more batches a frame');
  await s.frame(640, 360);
  assert.deepEqual(shape(), [26, 1, 676], 'a smaller screen gives its memory back');
  follows(676);
  const sized = s.said.filter(([phase]) => phase === 'shadow-pool').map(([, c]) => c.viewport);
  assert.deepEqual(sized, [
    [1280, 720],
    [640, 360],
    [1280, 720],
    [3456, 2234],
    [640, 360],
  ]);
  const pages = s.lights.plan.pool.pages;
  await s.frame(639, 360);
  assert.equal(s.lights.plan.pool.pages, pages, 'a size that asks the same pool keeps it');
  s.rt.capture.capturing = true;
  await s.frame(3456, 2234);
  assert.equal(s.lights.plan.pool.pages, pages, "a capture's temporary size resizes nothing");
});

test('pages requested before and after the resize keep their content: none is drawn again', async () => {
  const s = await session([1280, 720], true),
    { plan, store } = s.lights;
  const slice = () => store.sliceOf(0),
    read = () => [
      ...sunPages(plan, slice(), plan.sun.finest[slice()] + 4, [
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
      sunFloor(plan, slice()),
    ];
  const cycle = (frame: number) => {
    const drawn = planFrame(plan, store, frame);
    plan.commit();
    report(plan, store, frame, read());
    return drawn;
  };
  for (let frame = 0; frame < 4; frame++) cycle(frame);
  const entries = read(),
    before = entries.map((entry) => plan.table.words[entry]),
    mapped = new Map<number, number>();
  for (let page = 0; page < plan.pool.pages; page++)
    if (plan.pool.owner[page] >= 0) mapped.set(page, plan.pool.owner[page]);
  assert.ok(
    before.every((word) => word !== 0),
    'every page read is mapped and drawn',
  );
  await s.frame(3456, 2234);
  const after = entries.map((entry) => plan.table.words[entry]);
  assert.deepEqual(
    after.map((word) => word & ~PAGE_INDEX_MASK),
    before.map((word) => word & ~PAGE_INDEX_MASK),
    'each entry still reads a current page',
  );
  // The GPU was handed one move per page kept, from its old place to the one the table names.
  const moved = new Int32Array(2601).fill(-1);
  for (const [page, entry] of mapped.entries())
    moved[page] = plan.table.words[entry] & PAGE_INDEX_MASK;
  const depth = shadowPageMoves(moved, 51, 51),
    half = shadowPageMoves(moved, 51, 51, 0.5);
  assert.deepEqual([...s.gpu.moves[0]].sort(), [...depth].sort(), 'the pool pages');
  assert.deepEqual([...s.gpu.moves[1]].sort(), [...half].sort(), 'their translucent depth');
  assert.equal(s.gpu.copies.length, mapped.size, 'and their transmittance, one copy each');
  assert.deepEqual(
    s.gpu.passes.map(([layer]) => layer),
    [0, 0],
    'one pass per target layer',
  );
  assert.equal(cycle(4), 0, 'the frame after the resize draws no page again');
  assert.equal(cycle(5), 0);
});

test('a refused grant keeps the old pool and says so', async () => {
  const s = await session([1280, 720]);
  const held = s.texture(),
    pages = s.lights.plan.pool.pages;
  s.limit.bytes = 0;
  await s.frame(3456, 2234);
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
  await s.frame(3456, 2234);
  assert.equal(s.said.length, told, 'asked once per size, not every frame');
  s.limit.bytes = Infinity;
  await s.frame(1728, 1117);
  assert.equal(s.lights.plan.pool.pages, 4096, 'the next size is asked again');
});

test('a transmittance layer the resized pool cannot get keeps the old pool, said by name', async () => {
  const s = await session([1280, 720], true);
  const held = s.texture();
  // Room for the resized pool, not for a layer of 8 192² texels in two layers.
  s.limit.bytes = 400 * 2 ** 20;
  await s.frame(3456, 2234);
  assert.equal(s.texture(), held, 'the pool in place is kept');
  assert.equal(s.lights.plan.pool.pages, 2601);
  const [phase, context] = s.said.at(-1)!;
  assert.deepEqual(
    [phase, context.pool, context.grantedBytes],
    ['gpu-out-of-memory', 'shadow-transmittance', null],
  );
});

test('a pool the device halves below the one in place is not taken: the pool in place stays', async () => {
  const s = await session([1280, 720]);
  const held = s.texture();
  s.limit.bytes = shadowAtlasBytes(40);
  await s.frame(3456, 2234);
  assert.equal(s.texture(), held);
  assert.equal(s.lights.plan.pool.pages, 2601);
});

test('a transmittance layer past the shadow grant keeps the pool in place, said by name', async () => {
  const s = await session([1280, 720], true);
  const held = s.texture();
  Object.assign(s.lights.pageRequests!, { bytes: SHADOW_GRANT_BYTES });
  await s.frame(3456, 2234);
  assert.equal(s.texture(), held);
  const [phase, context] = s.said.at(-1)!;
  assert.deepEqual([phase, context.pressure], ['shadow-memory', 'transmittance-over-grant']);
});
