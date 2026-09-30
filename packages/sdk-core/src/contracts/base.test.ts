import assert from 'node:assert/strict';
import { basename, extname } from 'node:path';
import test from 'node:test';
import { CUTOUT_SHEET_FILE, DEFAULT_SCOPE, SDK_VERSION } from './base.ts';
import { assertCachePointer } from './cache.ts';

test('the engine version parses as major.minor.patch for a host', () => {
  const parts = SDK_VERSION.split(/[-+]/)[0].split('.').map(Number);
  assert.equal(parts.length, 3, SDK_VERSION);
  for (const part of parts) assert.ok(Number.isSafeInteger(part) && part >= 0, SDK_VERSION);
});

test('a model compiled at the default scope streams in pages', () => {
  const pointer = { status: 'ready', url: 'model/clusters.json', scope: DEFAULT_SCOPE };
  assert.equal(assertCachePointer(pointer, 'slice'), 'model/clusters.json');
});

test('the cut-out answer sheet is one JSON file at the cache root', () => {
  assert.equal(basename(CUTOUT_SHEET_FILE), CUTOUT_SHEET_FILE);
  assert.equal(extname(CUTOUT_SHEET_FILE), '.json');
  assert.ok(CUTOUT_SHEET_FILE.length > '.json'.length);
});
