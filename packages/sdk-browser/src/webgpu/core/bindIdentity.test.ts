import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuBindIdentity } from './bindIdentity.ts';

test('a family moves when one of the resources it names changes identity, and only then', () => {
  const identity = createWebgpuBindIdentity();
  const cache = {},
    table = {},
    pool = {};
  identity.next[0] = cache;
  identity.next[1] = table;
  identity.next[2] = pool;
  assert.equal(identity.moved(), true, 'the first reading moves from nothing to the resources');
  assert.equal(identity.moved(), false, 'the same resources move nothing');
  // A resized pool: another object, same place.
  identity.next[2] = {};
  assert.equal(identity.moved(), true);
  assert.equal(identity.moved(), false, 'and the replacement is now what is held');
  // A resource that is gone moves the family as much as one that arrived.
  identity.next[0] = undefined;
  assert.equal(identity.moved(), true);
});
