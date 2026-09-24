import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gitPaths } from '../../scripts/git-paths.ts';
import { readCookedPhysics } from '../../packages/sdk-core/src/physics/cooked.ts';

const root = new URL('../../', import.meta.url);

// Every `physics.json` the site ships is read by the engine it ships with: a cache cooked in an
// older format is refused at load (`PHYSICS_FORMAT`), so it is recompiled in the change that bumps
// the format, never left behind.
test('every committed physics.json is in the format the engine reads', async () => {
  const files = (await gitPaths(['ls-files', '-z'], fileURLToPath(root))).filter((file) =>
    file.endsWith('/physics.json'),
  );
  assert.ok(files.length > 0, 'the site ships cooked physics');
  const refused: string[] = [];
  for (const file of files) {
    try {
      readCookedPhysics(JSON.parse(await readFile(new URL(file, root), 'utf8')));
    } catch {
      refused.push(file);
    }
  }
  assert.deepEqual(refused, []);
});
