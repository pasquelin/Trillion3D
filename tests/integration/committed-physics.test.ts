import test from 'node:test';
import assert from 'node:assert/strict';
import { glob, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readCookedPhysics } from '../../packages/sdk-core/src/physics/cooked.ts';
import { COOKED_SCENES } from '../../scripts/site-caches.ts';

const root = new URL('../../', import.meta.url);

// Every `physics.json` the scene caches hold is read by the engine it ships with: a cache cooked in
// an older format is refused at load (`PHYSICS_FORMAT`); the compiler that bumps the format is
// newer than every cache, so `scripts/site-caches.ts` compiles them all again before this runs.
test('every compiled physics.json is in the format the engine reads', async () => {
  const patterns = Object.values(COOKED_SCENES).map(
    ({ directory }) => `${directory}/cache/native/full/*/physics.json`,
  );
  const files: string[] = [];
  for await (const file of glob(patterns, { cwd: fileURLToPath(root) })) files.push(file);
  assert.ok(files.length > 0, 'the site ships cooked physics');
  const refused: string[] = [];
  for (const file of files) {
    try {
      readCookedPhysics(JSON.parse(await readFile(new URL(file, root), 'utf8')));
    } catch (error) {
      refused.push(`${file}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(refused, []);
});
