import test from 'node:test';
import assert from 'node:assert/strict';
import { missingThumbnails, recettePendingThumbnailIds } from './check-thumbnails.ts';

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

test('the explicit issue 357 deferral exempts only its four captures', () => {
  const ids = [
    'a-character-that-walks',
    'additive-poses',
    'a-crowd-of-characters',
    'a-shape-that-morphs',
  ];
  assert.deepEqual([...recettePendingThumbnailIds], ids);
  const entries = [...ids, 'another-missing-example', 'captured'].map((id) => ({ id }));
  const captured = new Set(['captured']);
  assert.deepEqual(missingThumbnails(entries, new Set(), captured, recettePendingThumbnailIds), [
    'another-missing-example',
  ]);
  assert.deepEqual(missingThumbnails(entries, new Set(), captured), [
    ...ids,
    'another-missing-example',
  ]);
});
