import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingAttribute, pendingInterleaved } from './attribute.ts';

test('deferred buffers expose counts before loading, share concurrent reads and retain loaded numbers', async () => {
  let calls = 0;
  const array = new Float32Array([1, 2, 3, 4, 5, 6]);
  const attribute = pendingAttribute(
    {
      length: 6,
      type: 'Float32Array',
      read: async () => {
        calls++;
        return array;
      },
    },
    3,
    true,
  );
  assert.equal(attribute.count, 2);
  assert.equal(attribute.type, 'Float32Array');
  assert.equal(attribute.normalized, true);
  assert.throws(
    () => attribute.array,
    (error: any) => error.code === 'VERTICES_NOT_LOADED' && error.message.includes('loadVertices'),
  );
  await Promise.all([attribute._load(), attribute._load()]);
  assert.equal(calls, 1);
  assert.equal(attribute.array, array);
  assert.equal(attribute._pending, null);
  await attribute._load();
  assert.equal(calls, 1);
  const buffer = pendingInterleaved(
    { length: 6, type: 'Float32Array', read: async () => array },
    3,
  );
  assert.equal(buffer.count, 2);
  assert.throws(
    () => buffer.array,
    (error: any) => error.code === 'VERTICES_NOT_LOADED',
  );
  await buffer._load();
  assert.equal(buffer.array, array);
});

test('a failed deferred read is retried rather than caching a rejected promise', async () => {
  let calls = 0;
  const failure = new Error('network'),
    array = new Float32Array([1, 2, 3]);
  const attribute = pendingAttribute(
    {
      length: 3,
      type: 'Float32Array',
      read: async () => {
        if (++calls === 1) throw failure;
        return array;
      },
    },
    3,
    false,
  );
  await assert.rejects(attribute._load(), (error) => error === failure);
  assert.equal(attribute.count, 1);
  await attribute._load();
  assert.equal(calls, 2);
  assert.equal(attribute.array, array);
});
