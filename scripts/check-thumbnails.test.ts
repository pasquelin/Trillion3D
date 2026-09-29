import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { missingThumbnails, thumbnailReport } from './check-thumbnails.ts';

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

test('a missing thumbnail is listed for the recette, and the run still exits 0', () => {
  assert.equal(
    thumbnailReport(['bare', 'other']),
    'Thumbnails for the recette to capture: bare other',
  );
  const run = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('check-thumbnails.ts', import.meta.url))],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr);
});
