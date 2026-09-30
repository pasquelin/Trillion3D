// #1345: the shadow pool is sized from what the scene reads at the drawn size, never from the
// display: a one-cube scene on the boss's screen holds a few hundred pages, not the 5 040 the
// screen's bound asked, and a scene that asks past the memory budget is held at its ceiling.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shadowPoolShape,
  shadowPoolSize,
} from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import {
  askedPages,
  demandPoolPages,
} from '../../../../sdk-core/src/scene/light-shadow/poolDemand.ts';
import { shadowAtlasBytes } from '../../gpu/shadow/atlas.ts';
import { session } from './poolResize.fixture.ts';
import { shadowPoolSized } from './poolResize.ts';
import { SHADOW_ATLAS_BYTES } from '../../residency/shadowBudgetBytes.ts';

/** Pages a frame of a cube on a floor reads, its floor pages aside: the few levels its pixels
 *  land on around it. */
const CUBE_PAGES = 300;

test('the shadow pool of a one-cube scene is sized from its demand, not from the display', async () => {
  const s = await session(),
    viewport = s.rt.setup.viewport as number[];
  viewport.splice(0, 2, 3456, 2234);
  await s.ask(CUBE_PAGES);
  const { pool } = s.lights.plan,
    asked = askedPages(s.lights.plan),
    shape = shadowPoolShape(demandPoolPages(asked));
  assert.ok(asked >= CUBE_PAGES && asked < CUBE_PAGES + 16, `${asked} pages asked`);
  assert.deepEqual([pool.side, pool.layers], [shape.side, shape.layers], 'the demand sizes it');
  const display = shadowPoolSize(3456, 2234);
  assert.ok(pool.pages * 5 < display, `${pool.pages} pages, the display asked ${display}`);
  assert.ok(shadowAtlasBytes(pool.side, pool.layers) < 64 * 2 ** 20, 'under 64 MiB');
  // The same scene on another display asks the same pool.
  viewport.splice(0, 2, 1280, 720);
  await s.ask(CUBE_PAGES);
  assert.equal(s.lights.plan.pool.pages, pool.pages, 'the display changes nothing');
});

test('the first report sizes the budget pool to its demand at once, then the static layer', async () => {
  const s = await session(false, false),
    { plan } = s.lights,
    budget = plan.pool.pages;
  assert.equal(shadowPoolSized(s.lights), false, 'the static layer waits for the first report');
  await s.ask(CUBE_PAGES);
  const shape = shadowPoolShape(demandPoolPages(askedPages(plan)));
  assert.deepEqual([plan.pool.side, plan.pool.layers], [shape.side, shape.layers], 'one report');
  assert.ok(plan.pool.pages * 5 < budget, `${plan.pool.pages} of ${budget} pages`);
  assert.equal(shadowPoolSized(s.lights), true);
});

test('a demand past the memory budget is held at its ceiling, said once as a warning', async () => {
  const s = await session();
  await s.ask(6000);
  const { pool } = s.lights.plan;
  assert.equal(shadowAtlasBytes(pool.side, pool.layers) <= SHADOW_ATLAS_BYTES, true);
  const pools = () => s.said.filter(([phase]) => phase === 'shadow-pool');
  const [, context] = pools().at(-1)!;
  assert.equal(context.clamp, 'ceiling');
  assert.equal(context.pages, pool.pages);
  // Held there, the next report past it is told, as the reference engine warns of a physical pool overflow.
  for (let i = 0; i < 3; i++) await s.ask(6000);
  const warned = pools().filter(([, c]) => c.kind === 'warning');
  assert.equal(warned.length, 1, 'once, as the pool comes to its ceiling');
  assert.deepEqual([warned[0][1].clamp, warned[0][1].pages], ['ceiling', pool.pages]);
  assert.equal(s.said.filter(([phase]) => phase === 'gpu-out-of-memory').length, 0);
});

test('a scene at rest gives the memory back at once, not sixty reports later', async () => {
  const s = await session();
  await s.ask(1000, true);
  assert.equal(s.lights.plan.pool.pages, 2601);
  await s.ask(1000);
  assert.equal(s.lights.plan.pool.pages, 2601, 'a resting view that asks as much keeps it');
  await s.ask(50);
  assert.equal(s.lights.plan.pool.pages, 2601, 'a count that changed: a world may still move');
  await s.ask(50);
  assert.equal(s.lights.plan.pool.pages, 256, 'the same count again: what the scene asks');
  await s.ask(100, true);
  assert.equal(s.lights.plan.pool.pages, 256, 'moving within it keeps it');
});
