// The identity refusals of `cache.ts` (`assertCacheIdentity`), by code, details and the values its
// words name.
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCacheIdentity } from './cache.ts';
import { identity, refusesIdentity } from './cache.fixture.ts';

test('identity refuses undecoded sidecars, incompatible formats and stale texture layouts', () => {
  assert.doesNotThrow(() => assertCacheIdentity(identity as never));
  assert.doesNotThrow(() =>
    assertCacheIdentity({ ...identity, formatVersion: undefined } as never),
  );
  refusesIdentity({ ...identity, binary: { url: 'columns.bin' } }, 'INVALID_CACHE', {});
  refusesIdentity({ ...identity, schema: 10 }, 'UNSUPPORTED_FORMAT', {
    schema: 10,
    formatVersion: 9,
  });
  refusesIdentity({ ...identity, formatVersion: 1, schema: 1 }, 'UNSUPPORTED_FORMAT', {
    formatVersion: 1,
  });
  refusesIdentity(
    { ...identity, errorModel: undefined },
    'STALE_CACHE',
    { errorModel: null, expected: 'dag-group-qem-v3' },
    ['absent', 'dag-group-qem-v3'],
  );
  refusesIdentity(
    { ...identity, errorModel: 'dag-group-qem-v1' },
    'STALE_CACHE',
    { errorModel: 'dag-group-qem-v1', expected: 'dag-group-qem-v3' },
    ['dag-group-qem-v1', 'dag-group-qem-v3'],
  );
  refusesIdentity(
    { ...identity, textures: {} },
    'STALE_CACHE',
    { textureVersion: null, expected: 6 },
    ['absent', '6'],
  );
  refusesIdentity(
    { ...identity, textures: { version: 5 } },
    'STALE_CACHE',
    { textureVersion: 5, expected: 6 },
    ['version 5', '6'],
  );
  assert.doesNotThrow(() =>
    assertCacheIdentity({ ...identity, textures: { version: 6 } } as never),
  );
});

test('identity accepts whole meshes and refuses stale primitives with actionable identity', () => {
  const page = { lodError: 0, sphere: [0, 0, 0, 1] };
  const blend = { mesh: 3, primitive: 7, pass: 'clustered-blend', pages: [page] };
  assert.doesNotThrow(() =>
    assertCacheIdentity({
      ...identity,
      schema: 10,
      formatVersion: 10,
      primitives: [blend],
    } as never),
  );
  // Before format 10 no clustered blend was written: the refusal names the format it needs.
  refusesIdentity(
    { ...identity, primitives: [blend] },
    'UNSUPPORTED_FORMAT',
    { formatVersion: 9 },
    ['clustered-blend', 'format 10'],
  );
  const whole = { mesh: 3, primitive: 7, pass: 'shared-blend', pages: [] };
  assert.doesNotThrow(() => assertCacheIdentity({ ...identity, primitives: [whole] } as never));
  const stale = { errorModel: 'dag-group-qem-v3', expected: 'dag-group-qem-v3' };
  refusesIdentity(
    { ...identity, primitives: [{ ...whole, pages: [page] }] },
    'STALE_CACHE',
    { mesh: 3, primitive: 7, pass: 'shared-blend', ...stale },
    ['3/7', 'carries 1 cluster pages'],
  );
  refusesIdentity(
    { ...identity, primitives: [{ mesh: 11, primitive: 13, pages: [{ lodError: 0 }] }] },
    'STALE_CACHE',
    { mesh: 11, primitive: 13, pass: undefined, ...stale },
    ['11/13', 'error band'],
  );
});
