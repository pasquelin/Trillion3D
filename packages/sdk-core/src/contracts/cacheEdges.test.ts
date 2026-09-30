import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCachePointer,
  assertCacheReady,
  assertCacheRoot,
  assertFormat,
  EngineError,
} from './cache.ts';

const root = {
  schema: 9,
  formatVersion: 9,
  status: 'ready',
  scope: 'full',
  primitives: [],
  selectedNodes: 0,
  selectedTriangles: 0,
};
const refuses = (work: () => unknown, code: string, details?: Record<string, unknown>) => {
  assert.throws(work, (error) => {
    assert.ok(error instanceof EngineError);
    assert.equal(error.name, 'EngineError');
    assert.equal(error.code, code);
    assert.ok(error.message.trim().length > 0);
    if (details) assert.deepEqual(error.details, details);
    return true;
  });
};

test('pointers return their URL only when ready, with compatible optional scope and format', () => {
  const callable = Object.assign(() => {}, { status: 'ready', url: 'clusters.json' });
  refuses(() => assertCachePointer(callable, 'full'), 'INVALID_POINTER');
  refuses(
    () => assertCachePointer(Object.assign([], { status: 'ready', url: 'clusters.json' }), 'full'),
    'INVALID_POINTER',
  );
  const pointer = { status: 'ready', url: 'cache/model/clusters.json' };
  assert.equal(assertCachePointer(pointer, 'full'), pointer.url);
  assert.equal(
    assertCachePointer({ ...pointer, scope: 'full', formatVersion: 9 }, 'full'),
    pointer.url,
  );
  for (const value of [undefined, null, false, 'pointer', [], 3])
    refuses(() => assertCachePointer(value, 'full'), 'INVALID_POINTER');
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
  refuses(() => assertCachePointer({ ...pointer, scope: 'slice' }, 'full'), 'SCOPE_MISMATCH', {
    requestedScope: 'full',
    pointerScope: 'slice',
  });
  refuses(
    () => assertCachePointer({ ...pointer, formatVersion: 1 }, 'full'),
    'UNSUPPORTED_FORMAT',
    { formatVersion: 1 },
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
  refuses(() => assertCacheRoot({ ...root, scope: 'slice' }, 'full'), 'SCOPE_MISMATCH', {
    requestedScope: 'full',
    cacheScope: 'slice',
  });
  for (const format of [0, 1, 8, 11, NaN])
    refuses(() => assertFormat(format), 'UNSUPPORTED_FORMAT', { formatVersion: format });
  for (const format of [9, 10]) assert.doesNotThrow(() => assertFormat(format));
});

test('ready cache counts must be finite numbers and nodes must be safe integers', () => {
  assert.throws(
    () => assertCacheReady({ ...root, clusterStrategy: 'dag-groups' }, 'full'),
    (error: any) => error.message.includes('absent'),
  );
  assert.throws(
    () =>
      assertCacheReady({ ...root, clusterStrategy: 'dag-groups', errorModel: 'legacy-v2' }, 'full'),
    (error: any) =>
      error.message.includes('legacy-v2') && error.message.includes('dag-group-qem-v3'),
  );
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
  assert.equal(
    assertCacheReady(
      { ...root, clusterStrategy: 'dag-groups', errorModel: 'dag-group-qem-v3' },
      'full',
    ),
    0,
  );
  refuses(
    () => assertCacheReady({ ...root, clusterStrategy: 'dag-groups' }, 'full'),
    'STALE_CACHE',
    { errorModel: null, expected: 'dag-group-qem-v3' },
  );
  refuses(
    () => assertCacheReady({ ...root, clusterStrategy: 'dag-groups', errorModel: 'old' }, 'full'),
    'STALE_CACHE',
    { errorModel: 'old', expected: 'dag-group-qem-v3' },
  );
});
