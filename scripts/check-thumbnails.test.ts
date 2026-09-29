import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { missingThumbnails } from './check-thumbnails.ts';

test('a written example with no thumbnail is named, unless it is parked', () => {
  const entries = [{ id: 'captured' }, { id: 'parked' }, { id: 'bare' }];
  assert.deepEqual(missingThumbnails(entries, new Set(['parked']), new Set(['captured'])), [
    'bare',
  ]);
  assert.deepEqual(
    missingThumbnails(entries, new Set(['parked', 'bare']), new Set(['captured'])),
    [],
  );
});

test('the report lists what the recette still captures and never fails a run', () => {
  const run = spawnSync(process.execPath, ['scripts/check-thumbnails.ts'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^(Thumbnails for the recette to capture: |Every gallery example)/);
});
