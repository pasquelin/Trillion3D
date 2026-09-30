// #1208: the shadow pool follows a canvas resize at runtime; a resize the grant or the device
// refuses keeps the pool in place, said by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { session } from './poolResize.fixture.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';

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
