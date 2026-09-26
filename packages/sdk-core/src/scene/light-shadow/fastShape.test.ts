// A moving frame reads the pool, the table and the slices page by page and entry by entry: those
// objects stay in V8's fast mode. One accessor in an object literal puts it in dictionary mode,
// and every read of its arrays in those loops then costs a hash lookup (#26).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cycle, movingScene } from './lightShadow.fixture.ts';

// The plan's own, and the change list and thresholds it keeps to itself.
const SHAPED = ['pool', 'table', 'records', 'admission', 'counts', 'sun', 'changes', 'thresholds'];
const url = (file: string) => JSON.stringify(new URL(file, import.meta.url).href);

test('the objects a moving frame reads page by page keep fast properties', () => {
  const probe = `
    import { movingScene } from ${url('./lightShadow.fixture.ts')};
    import { createShadowChanges } from ${url('./changes.ts')};
    import { createShadowThresholds } from ${url('./thresholds.ts')};
    const { plan } = movingScene();
    const own = { changes: createShadowChanges(plan.pool.pages), thresholds: createShadowThresholds(plan.pool) };
    console.log(JSON.stringify(${JSON.stringify(SHAPED)}.map((name) => %HasFastProperties(own[name] ?? plan[name]))));`;
  const run = spawnSync(
    process.execPath,
    ['--allow-natives-syntax', '--experimental-strip-types', '--input-type=module', '-e', probe],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(run.status, 0, run.error?.message ?? run.stderr);
  assert.deepEqual(
    JSON.parse(run.stdout.trim().split('\n').at(-1) ?? ''),
    SHAPED.map(() => true),
    SHAPED.join(', '),
  );
});

test('the counts kept as data fields stay true as pages and slices are taken and released', () => {
  const { store, plan } = movingScene(),
    { pool } = plan;
  const mapped = pool.owner.filter((entry) => entry >= 0).length;
  assert.ok(mapped > 0, 'the frames mapped pages');
  assert.equal(pool.used(), mapped, 'the pages mapped, counted as they are taken and released');
  assert.equal(plan.records.count, 2, 'one slice a shadow light');
  store.remove('lamp');
  cycle(plan, store, 8, () => []);
  assert.equal(plan.records.count, 1, 'a light gone gives its slice back');
  plan.reset();
  assert.equal(plan.records.count, 0);
  assert.equal(pool.used(), 0);
});
