import test from 'node:test';
import assert from 'node:assert/strict';
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
