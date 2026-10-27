import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../world/object/index.ts'
import { resolveViewOwner } from './viewOptions.ts'

test('a view’s owner is a node of the scene or null, nothing else', () => {
  const player = object.group()
  assert.equal(resolveViewOwner(null), null)
  assert.equal(resolveViewOwner(player), player)
  for (const bad of [5, 'player', undefined, {}, { isObject3D: 1 }])
    assert.throws(
      () => resolveViewOwner(bad as never),
      /owner: must be a node of the scene or null/,
    )
})
