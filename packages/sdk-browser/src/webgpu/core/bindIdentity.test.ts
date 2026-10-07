import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuBindIdentity } from './bindIdentity.ts'
import { entriesIdentity } from './entriesIdentity.ts'

test('a family moves when one of the resources it names changes identity, and only then', () => {
  const identity = createWebgpuBindIdentity()
  const cache = {},
    table = {},
    pool = {}
  identity.next[0] = cache
  identity.next[1] = table
  identity.next[2] = pool
  assert.equal(identity.moved(), true, 'the first reading moves from nothing to the resources')
  assert.equal(identity.moved(), false, 'the same resources move nothing')
  // A resized pool: another object, same place.
  identity.next[2] = {}
  assert.equal(identity.moved(), true)
  assert.equal(identity.moved(), false, 'and the replacement is now what is held')
  // A resource that is gone moves the family as much as one that arrived.
  identity.next[0] = undefined
  assert.equal(identity.moved(), true)
})

test('entry membership, binding numbers and buffer ranges all invalidate without a second resource list', () => {
  const identity = createWebgpuBindIdentity()
  const binding = { buffer: {} as GPUBuffer, offset: 0, size: 16 }
  const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: binding }]
  const moved = () => {
    identity.next.length = entriesIdentity(entries, identity.next)
    return identity.moved()
  }
  assert.equal(moved(), true)
  assert.equal(moved(), false)
  entries.push({ binding: 1, resource: {} as GPUSampler })
  assert.equal(moved(), true, 'only the entry list gained a resource')
  assert.equal(moved(), false)
  binding.offset = 8
  assert.equal(moved(), true)
  binding.size = 8
  assert.equal(moved(), true)
  entries[0].binding = 2
  assert.equal(moved(), true)
  entries.pop()
  assert.equal(moved(), true, 'removing an entry also invalidates')
  assert.equal(moved(), false)
})
