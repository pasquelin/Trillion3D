// #831: the shadow pool keeps the size its setting gives it, as the reference engine keeps
// `a reference setting`. A pool that followed the demand shrank and grew again under
// a moving view, every page moved each time, its static layer let go, and the pages the GPU had
// mapped since the last report kept table words naming pages that then held other entries: dark
// page-shaped shards on drive-a-car's terrain, and grain on the car.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { session } from './poolSession.fixture.ts';

test('the pool keeps its setting’s size whatever the reports ask: no page changes place', async () => {
  const s = await session(),
    { pool } = s.lights.plan;
  assert.equal(pool.pages, LIGHT_SETTINGS.shadowPoolPages);
  s.ask(3000, true);
  const held = [...pool.owner];
  // Seventy reports asking for a pool a hundred times smaller, under a moving view: what shrank
  // the demand-following pool past sixty of them.
  for (let i = 0; i < 70; i++) s.ask(30, true);
  assert.equal(s.lights.plan.pool, pool, 'the same pool');
  assert.equal(s.taken.length, 1, 'one texture, taken once');
  const kept = held.filter((entry, page) => entry >= 0 && pool.owner[page] === entry).length;
  assert.equal(kept, held.filter((entry) => entry >= 0).length, 'every page where it was');
  s.ask(6000);
  assert.equal(s.lights.plan.pool.pages, LIGHT_SETTINGS.shadowPoolPages, 'nor grows past it');
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
