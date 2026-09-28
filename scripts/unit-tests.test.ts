import test from 'node:test';
import assert from 'node:assert/strict';
import { shardFlags } from './unit-tests.ts';

test('a local run keeps the whole suite; a CI shard asks node for its share', () => {
  assert.deepEqual(shardFlags({}), []);
  assert.deepEqual(shardFlags({ TRILLION3D_TEST_SHARD: '' }), []);
  assert.deepEqual(shardFlags({ TRILLION3D_TEST_SHARD: '2/3' }), ['--test-shard=2/3']);
});

test('a malformed shard stops the run instead of silently dropping tests', () => {
  for (const shard of ['0/3', '4/3', '3', '1/0', 'a/b', '1/3 '])
    assert.throws(
      () => shardFlags({ TRILLION3D_TEST_SHARD: shard }),
      /TRILLION3D_TEST_SHARD/,
      shard,
    );
});
