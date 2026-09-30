// The refusals of `cache.ts` by value: each names its code, the facts a host acts on in `details`,
// and words for a person that carry the values refused.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCachePointer, assertCacheReady, assertCacheRoot, assertFormat } from './cache.ts';
import { refuses, root } from './cache.fixture.ts';

test('pointers return their URL only when ready, with compatible optional scope and format', () => {
  const pointer = { status: 'ready', url: 'cache/model/clusters.json' };
  assert.equal(assertCachePointer(pointer, 'full'), pointer.url);
  assert.equal(
    assertCachePointer({ ...pointer, scope: 'full', formatVersion: 9 }, 'full'),
    pointer.url,
  );
  for (const value of [undefined, null, false, 'pointer', 3, Object.assign(() => {}, pointer)])
    refuses(() => assertCachePointer(value, 'full'), 'INVALID_POINTER');
  refuses(() => assertCachePointer(Object.assign([], pointer), 'full'), 'INVALID_POINTER');
  for (const [patch, details] of [
    [{ status: 1 }, { status: 1, url: pointer.url }],
    [{ status: undefined }, { status: null, url: pointer.url }],
    [{ url: 1 }, { status: 'ready', url: 1 }],
    [{ url: '' }, { status: 'ready', url: '' }],
    [{ url: undefined }, { status: 'ready', url: null }],
  ])
    refuses(() => assertCachePointer({ ...pointer, ...patch }, 'full'), 'INVALID_POINTER', details);
  refuses(() => assertCachePointer({ ...pointer, status: 'pending' }, 'full'), 'CACHE_NOT_READY', {
    status: 'pending',
  });
  refuses(
    () => assertCachePointer({ ...pointer, scope: 'slice' }, 'full'),
    'SCOPE_MISMATCH',
    { requestedScope: 'full', pointerScope: 'slice' },
    ['full', 'slice'],
  );
  refuses(
    () => assertCachePointer({ ...pointer, formatVersion: 1 }, 'full'),
    'UNSUPPORTED_FORMAT',
    { formatVersion: 1 },
    ['9', '10', 'received 1'],
  );
});

test('cache roots reject malformed, unfinished, mismatched and unsupported metadata', () => {
  assert.doesNotThrow(() => assertCacheRoot(root, 'full'));
  assert.doesNotThrow(() => assertCacheRoot({ ...root, formatVersion: undefined }, 'full'));
  for (const value of [undefined, null, [], 'root'])
    refuses(() => assertCacheRoot(value, 'full'), 'INVALID_CACHE');
  refuses(() => assertCacheRoot({ ...root, schema: 10 }, 'full'), 'UNSUPPORTED_FORMAT', {
    schema: 10,
    formatVersion: 9,
  });
  refuses(() => assertCacheRoot({ ...root, status: undefined }, 'full'), 'INVALID_CACHE', {
    status: null,
  });
  refuses(() => assertCacheRoot({ ...root, status: 'pending' }, 'full'), 'INVALID_CACHE', {
    status: 'pending',
  });
  refuses(
    () => assertCacheRoot({ ...root, scope: 'slice' }, 'full'),
    'SCOPE_MISMATCH',
    { requestedScope: 'full', cacheScope: 'slice' },
    ['full', 'slice'],
  );
  for (const format of [0, 1, 8, 11, NaN])
    refuses(() => assertFormat(format), 'UNSUPPORTED_FORMAT', { formatVersion: format });
  for (const format of [9, 10]) assert.doesNotThrow(() => assertFormat(format));
});

test('ready cache counts must be finite numbers and nodes must be safe integers', () => {
  assert.equal(assertCacheReady(root, 'full'), 0);
  assert.equal(
    assertCacheReady({ ...root, selectedTriangles: 123, selectedNodes: 7 }, 'full'),
    123,
  );
  for (const patch of [
    { primitives: {} },
    { selectedNodes: 0.5 },
    { selectedNodes: Number.MAX_SAFE_INTEGER + 1 },
    { selectedNodes: NaN },
    { selectedTriangles: NaN },
    { selectedTriangles: Infinity },
    { selectedTriangles: '0' },
  ])
    refuses(() => assertCacheReady({ ...root, ...patch }, 'full'), 'INVALID_CACHE');
  const dag = { ...root, clusterStrategy: 'dag-groups' };
  assert.equal(assertCacheReady({ ...dag, errorModel: 'dag-group-qem-v3' }, 'full'), 0);
  refuses(
    () => assertCacheReady(dag, 'full'),
    'STALE_CACHE',
    { errorModel: null, expected: 'dag-group-qem-v3' },
    ['absent', 'dag-group-qem-v3'],
  );
  refuses(
    () => assertCacheReady({ ...dag, errorModel: 'legacy-v2' }, 'full'),
    'STALE_CACHE',
    { errorModel: 'legacy-v2', expected: 'dag-group-qem-v3' },
    ['legacy-v2', 'dag-group-qem-v3'],
  );
});
