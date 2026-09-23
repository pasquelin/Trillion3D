import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { writeModelScenes } from './docs/examples/models.ts';

const examples = resolve(import.meta.dirname, '../site/assets/examples');

test('the scenes modelled in code rebuild their committed sources byte for byte', async () => {
  // The courtyard is left out for time alone: its five images take seconds to draw.
  const scenes = [
      'a-model-from-obj',
      'a-model-from-usdz',
      'detail-by-pixel-error',
      'ten-thousand-objects',
    ],
    out = await mkdtemp(join(tmpdir(), 'example-scenes-'));
  try {
    await writeModelScenes(out, resolve(examples, 'models'), scenes);
    for (const scene of scenes) {
      const files = await readdir(resolve(out, scene, 'source'));
      assert.deepEqual(files.sort(), (await readdir(resolve(examples, scene, 'source'))).sort());
      for (const file of files)
        assert.ok(
          (await readFile(resolve(out, scene, 'source', file))).equals(
            await readFile(resolve(examples, scene, 'source', file)),
          ),
          `${scene}/${file}`,
        );
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
