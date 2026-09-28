import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryMissingThumbnails, missingThumbnails } from './check-thumbnails.ts';

test('a written example with no thumbnail is named, unless it is parked', () => {
  const entries = [{ id: 'captured' }, { id: 'parked' }, { id: 'bare' }];
  assert.deepEqual(missingThumbnails(entries, new Set(['parked']), ['captured']), ['bare']);
  assert.deepEqual(missingThumbnails(entries, new Set(['parked', 'bare']), ['captured']), []);
});

test('every gallery example that is not parked has its thumbnail', () => {
  assert.deepEqual(galleryMissingThumbnails(), []);
});
