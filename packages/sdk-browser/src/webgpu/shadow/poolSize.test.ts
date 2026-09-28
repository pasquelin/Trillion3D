import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shadowPoolSide,
  shadowPoolSize as pages,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { shadowPoolFor, sizeShadowPool } from './poolSize.ts';
import { SHADOW_ATLAS_BYTES } from '../../residency/memoryBudget.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { SUN } from '../../../../sdk-core/src/scene/light-shadow/lightShadow.fixture.ts';
import { refusingDevice } from './poolDevice.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** A session whose device, `textureSide` texels wide, refuses, as out of memory, every texture
 *  past `limit` bytes; its atlas records the side it was sized at, and what the frame was told. */
function session(viewport: [number, number], limit = Infinity, textureSide = 8192) {
  installGpuGlobals();
  const lights = createWebgpuLightState(shadowPoolSide(300, 150));
  lights.plan.setPageInvalidation(false);
  const sized: number[] = [],
    said: Array<[string, Record<string, unknown>]> = [];
  let texture: object | undefined,
    uncaptured = 0,
    changed = 0;
  const gpu = refusingDevice(limit, { limits: { maxTextureDimension2D: textureSide } });
  gpu.device.addEventListener('uncapturederror', () => uncaptured++);
  lights.shadows = {
    get texture() {
      return texture;
    },
    makePool: (side: number, layers: number) =>
      gpu.device.createTexture({
        size: [side * 128, side * 128, layers],
        format: 'depth32float',
        usage: 0,
      }),
    sizePool(side: number, _: number, made: object) {
      texture = made;
      sized.push(side);
    },
  } as unknown as NonNullable<typeof lights.shadows>;
  const capture = { capturing: false };
  const rt = {
    lights,
    capture,
    setup: { viewport },
    blendState: { blendGpu: [] },
    gpu: { device: gpu.device },
    run: { lost: false, gate: { resourcesChanged: () => changed++ } },
    signal: new AbortController().signal,
    diag: {
      engineDiagnostic: (phase: string, _: string, context: Record<string, unknown>) =>
        said.push([phase, context]),
      diagnosticFailure: (phase: string) => said.push([phase, {}]),
    },
  } as unknown as WebgpuPagesRuntime;
  const size = async () => {
    sizeShadowPool(rt);
    await lights.shadowGrant?.done;
  };
  return {
    rt,
    lights,
    capture,
    sized,
    said,
    size,
    get uncaptured() {
      return uncaptured;
    },
    get changed() {
      return changed;
    },
  };
}

// A world prepares on a canvas that is not laid out yet — 300 × 150, the HTML default — and takes
// its real drawing buffer at its first frame: the pool follows that frame, once.
test('the shadow pool is sized by the first frame on the canvas, not by the canvas at creation', async () => {
  const viewport: [number, number] = [1280, 720];
  const s = session(viewport);
  s.capture.capturing = true;
  await s.size();
  assert.deepEqual(s.sized, [], "a capture's temporary size sizes nothing");
  s.capture.capturing = false;
  s.lights.store.add({ ...SUN, castsShadow: false });
  await s.size();
  assert.deepEqual(s.sized, [], 'no light casts a shadow: no pool');
  s.lights.store.add({ ...SUN, id: 'shadow sun' });
  await s.size();
  assert.deepEqual(s.sized, [51]);
  assert.equal(s.lights.plan.pool.side, 51, 'the plan follows the atlas');
  assert.equal(s.lights.plan.pageInvalidation, false, "the host's setting is kept");
  assert.equal(s.changed, 1, 'the granted pool is a new resource: the next frame is drawn');
  viewport[0] = 3840;
  viewport[1] = 2160;
  await s.size();
  assert.deepEqual(s.sized, [51], 'a later resize leaves the budget where it is');
});

test('a shadow pool the device refuses is drawn smaller, said, and never taken for a lost device', async () => {
  const wanted = shadowPoolSide(1280, 720);
  // Room for a quarter of the pool's bytes: 51² pages refused, then half, then half again.
  const s = session([1280, 720], shadowAtlasBytes(wanted) / 4);
  s.lights.store.add({ ...SUN, id: 'shadow sun' });
  await s.size();
  const side = s.sized[0];
  assert.ok(side < wanted && shadowAtlasBytes(side) <= shadowAtlasBytes(wanted) / 4, `${side}`);
  assert.equal(s.lights.plan.pool.side, side, 'the plan pages the pool the device granted');
  const [phase, context] = s.said[0];
  assert.equal(phase, 'gpu-out-of-memory');
  assert.equal(context.pool, 'shadow');
  assert.equal(context.grantedBytes, shadowAtlasBytes(side));
  assert.deepEqual(s.lights.memory.events, ['pool-shrunk'], 'a pressure, by name');
  assert.equal(s.lights.memory.bias, 2, 'a quarter of the bytes: two halvings');
  assert.equal(s.uncaptured, 0, 'every refusal was caught by its scope: no device loss');
});

test('a shadow pool refused even at its floor leaves the frame whole and says shadows are off', async () => {
  const s = session([1280, 720], 0);
  s.lights.store.add({ ...SUN, id: 'shadow sun' });
  await s.size();
  assert.deepEqual(s.sized, [], 'no pool: the frame is drawn without shadows');
  assert.equal(s.lights.shadows?.texture, undefined);
  assert.deepEqual(
    s.said.map(([phase, context]) => [phase, context.reason ?? context.grantedBytes]),
    [
      ['gpu-out-of-memory', null],
      ['shadows-off', 'gpu-out-of-memory'],
    ],
    'shadows lost are never silent: the page is told they are off',
  );
  assert.equal(s.lights.shadowGrant?.settled, true, 'the grant settled: no frame waits on it');
  assert.match(String(s.lights.shadowReason), /refused/, "every frame's shadow report says so");
  assert.deepEqual(s.lights.memory.events, ['pool-refused']);
  await s.size();
  assert.equal(s.said.length, 2, 'a refusal is asked once, not every frame');
  assert.equal(s.uncaptured, 0);
});

test('the shadow pool rule never draws above the screen nor below the smallest one', () => {
  const draw = shadowPoolFor(2601);
  assert.deepEqual(draw(shadowAtlasBytes(51)), {
    budgetBytes: shadowAtlasBytes(51),
    side: 51,
    layers: 1,
    allocatedBytes: shadowAtlasBytes(51),
    clamp: null,
  });
  assert.equal(draw(shadowAtlasBytes(64)).side, 51);
  assert.equal(draw(shadowAtlasBytes(20)).clamp, 'device-limit');
  assert.equal(shadowPoolFor(20160)(shadowAtlasBytes(51, 2)).layers, 2, 'no layer past the grant');
  const wide = shadowPoolFor(5040, 16384 / 128)(Infinity);
  assert.deepEqual([wide.side, wide.layers], [71, 1], 'a device 16 384 texels wide: one layer');
  assert.equal(shadowPoolFor(20160)(SHADOW_ATLAS_BYTES).clamp, 'ceiling', 'the budget holds it');
  const floor = draw(1);
  assert.equal(floor.side, shadowPoolSide(1, 1));
  assert.equal(floor.clamp, 'minimum');
});

test('at 3 456 × 2 234, one sun sizes two layers of 51 pages a side: 5 202 pages', async () => {
  const s = session([3456, 2234]);
  s.lights.store.add({ ...SUN, id: 'shadow sun' });
  await s.size();
  assert.deepEqual([s.lights.plan.pool.side, s.lights.plan.pool.layers], [51, 2]);
  const [, context] = s.said.find(([phase]) => phase === 'shadow-pool')!;
  assert.deepEqual([context.layers, context.pages], [2, 5202]);
});

test('the side follows the pages the pool holds; the device side is only the cap', () => {
  // A pool of 2 160 pages is the one square that holds them, and its bytes.
  const held = shadowPoolFor(2160, 128)(Infinity);
  assert.deepEqual([held.side, held.layers], [47, 1]);
  assert.equal(held.allocatedBytes, shadowAtlasBytes(47));
  // One sun over 3 456 × 2 234 asks 5 040 pages, 71²; over 3 840 × 2 160, 5 440 pages, 74².
  const sides = [pages(3456, 2234), pages(3840, 2160)].map((n) => shadowPoolFor(n, 128)(Infinity));
  assert.deepEqual(
    sides.map(({ side, layers }) => side ** 2 * layers),
    [5041, 5476],
  );
});

test('a pool the memory budget holds short of what the screen asks is said held by the budget', async () => {
  // Two suns over 3 456 × 2 234 ask more pages than the budget's atlas bytes hold; a device
  // 16 384 texels wide grants all it is asked: the budget, not the device, cut the pool.
  const s = session([3456, 2234], Infinity, 16384);
  s.lights.store.add({ ...SUN, id: 'first sun' });
  s.lights.store.add({ ...SUN, id: 'second sun' });
  await s.size();
  const [, context] = s.said.find(([phase]) => phase === 'shadow-pool')!;
  assert.ok((context.pages as number) < pages(3456, 2234, 2));
  assert.equal(context.bytes, shadowAtlasBytes(74));
  assert.equal(context.clamp, 'ceiling');
  assert.equal(s.said.filter(([phase]) => phase === 'gpu-out-of-memory').length, 0);
});
