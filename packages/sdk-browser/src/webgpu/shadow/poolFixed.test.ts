// #831: the shadow pool keeps the size its setting gives it, as Unreal keeps
// `r.Shadow.Virtual.MaxPhysicalPages`. A pool that followed the demand shrank and grew again under
// a moving view, every page moved each time, its static layer let go, and the pages the GPU had
// mapped since the last report kept table words naming pages that then held other entries: dark
// page-shaped shards on drive-a-car's terrain, and grain on the car.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  screenPoolPages,
  shadowPoolShape,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { SCREEN, session } from './poolSession.fixture.ts';
import { shadowPoolShapeOf } from './poolSize.ts';
import { shadowPoolHeld, shadowPoolShown } from './memoryGrant.ts';
import { disposeStaticLayer } from '../pages/state/lights.ts';

/** The pages the maintainer's screen reads by default: 2 520, a pool of 51². */
const SCREEN_POOL = 51 * 51;

// The default is the screen's page budget, chosen once (#831): one shadowed light's smooth read
// over it and a third more while pages wait, where the 4 096 pages declared before held 555 MB.
test('the pool a session opens with is what its screen reads: 2 601 pages, 163 MiB a layer', async () => {
  assert.equal(screenPoolPages(...SCREEN), 2520);
  assert.deepEqual(shadowPoolShape(screenPoolPages(...SCREEN)), { side: 51, layers: 1 });
  const s = await session();
  assert.equal(s.lights.plan.pool.pages, SCREEN_POOL);
  assert.deepEqual(s.taken[0].size, [51 * 128, 51 * 128, 1]);
  // The pool and the static layer that mirrors it page for page: 2 × 170 459 136 bytes.
  assert.equal(shadowAtlasBytes(51), 170_459_136);
  assert.equal(screenPoolPages(1280, 720), 320, 'a smaller screen, a smaller pool');
});

test('the pool keeps its size whatever the reports ask: no page changes place', async () => {
  const s = await session(),
    { pool } = s.lights.plan;
  assert.equal(pool.pages, SCREEN_POOL);
  s.ask(2000, true);
  const held = [...pool.owner];
  // Seventy reports asking for a pool a hundred times smaller, under a moving view: what shrank
  // the demand-following pool past sixty of them.
  for (let i = 0; i < 70; i++) s.ask(30, true);
  assert.equal(s.lights.plan.pool, pool, 'the same pool');
  assert.equal(s.taken.length, 1, 'one texture, taken once');
  const kept = held.filter((entry, page) => entry >= 0 && pool.owner[page] === entry).length;
  assert.equal(kept, held.filter((entry) => entry >= 0).length, 'every page where it was');
  s.ask(6000);
  assert.equal(s.lights.plan.pool.pages, SCREEN_POOL, 'nor grows past it');
  const warned = s.said.filter(([phase, context]) => phase === 'shadow-pool' && context.wanted);
  assert.deepEqual(
    warned.map(([, context]) => context.clamp),
    ['ceiling'],
    'a report past it is said once',
  );
});

test('a world’s shadowPoolPages option sets the pool it allocates once', async () => {
  const s = await session(1024);
  assert.equal(s.lights.plan.pool.pages, 1024);
  assert.deepEqual(s.taken[0].size, [32 * 128, 32 * 128, 1]);
  s.ask(1800, true);
  assert.equal(s.lights.plan.pool.pages, 1024, 'a demand past it reads coarser, never resizes');
});

// A fixed pool is sized for the widest buffer the session can reach (#831): a window opened small
// and put full screen later reads the display's pages, never a coarser level for want of them.
test("the default pool is the display's whole screen, or the canvas if wider", () => {
  const pixelRatio = () => 2,
    shape = (viewport: [number, number]) => shadowPoolShapeOf({ viewport, pixelRatio });
  assert.deepEqual(shape([960, 540]), shadowPoolShape(screenPoolPages(960, 540)), 'no display');
  Object.defineProperty(globalThis, 'screen', {
    value: { width: 1728, height: 1117 },
    configurable: true,
  });
  try {
    assert.deepEqual(shape([960, 540]), shadowPoolShape(screenPoolPages(...SCREEN)));
    assert.deepEqual(
      shape([4000, 540]),
      shadowPoolShape(screenPoolPages(4000, 2234)),
      'a canvas wider than the display',
    );
  } finally {
    delete (globalThis as { screen?: unknown }).screen;
  }
});

// The bytes shown are the setting's from the first frame (#831): the static layer was made at the
// first move, so the same pool read 188 MB on a-field-of-pebbles and 359 MB once the car moved.
test('the static layer is made with the pool: its bytes held before anything moves', async () => {
  const s = await session();
  const layer = shadowAtlasBytes(51);
  assert.equal(shadowPoolHeld(s.lights) - (s.lights.pageRequests?.bytes ?? 0), layer);
  assert.equal(shadowPoolShown(s.lights), shadowPoolHeld(s.lights), 'shown once granted');
  const pool = { sizesPool: true, settled: false, done: Promise.resolve() };
  s.lights.shadowGrant = pool;
  assert.equal(shadowPoolShown(s.lights), null, 'never the atlas alone while the grant holds');
  s.lights.shadowGrant = { settled: false, done: Promise.resolve() };
  assert.equal(
    shadowPoolShown(s.lights),
    shadowPoolHeld(s.lights),
    'a later grant, the transmittance layer, hides no pool bytes',
  );
  s.lights.shadowGrant = undefined;
  assert.ok(s.lights.staticLayerTexture, 'its texture made, held by the light state');
  // Freed with the layer, its bytes no longer counted: no texture nobody holds is shown.
  const held = shadowPoolHeld(s.lights);
  disposeStaticLayer(s.lights);
  assert.equal(s.lights.staticLayerTexture, undefined);
  assert.equal(shadowPoolHeld(s.lights), held - layer);
});

// #831: the boss read 551 758 544 bytes where 359 MB was announced. The setting said is every byte
// the pool holds — atlas, static layer, buffers, the pair lists —, not the atlas alone, and it is
// the very figure every frame shows; a display wider than the canvas sizes it (above).
test('the setting said is the bytes every frame shows, not the atlas alone', async () => {
  const s = await session();
  const setting = s.opened.find(([phase]) => phase === 'shadow-pool');
  assert.ok(setting, 'the pool said at its setting');
  assert.equal(setting[1].bytes, shadowPoolShown(s.lights));
  assert.equal(setting[1].atlasBytes, shadowAtlasBytes(51));
  assert.ok(Number(setting[1].bytes) > shadowAtlasBytes(51), 'its static layer and buffers too');
});
