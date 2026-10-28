// The capsule shadow switches of an object and its shadow body (`Object3D.castCapsuleDirectShadow`, `castCapsuleIndirectShadow`,
// `capsuleIndirectShadowMinVisibility`, `shadowCapsules`): off, a tenth and none by default, checked on write, copied with the node.
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from './index.ts'
import { geometry } from '../geometry/index.ts'

const SPHERE = { bone: 'head', kind: 'sphere', center: [0, 1.7, 0], radius: 0.12 } as const

test('a node casts no capsule shadow until it asks, and a refused write changes nothing', () => {
  const body = object.mesh(geometry.box(1, 1, 1))
  assert.deepEqual([body.castCapsuleDirectShadow, body.castCapsuleIndirectShadow], [false, false])
  assert.equal(body.capsuleIndirectShadowMinVisibility, 0.1)
  assert.deepEqual(body.shadowCapsules, [])
  assert.throws(() => (body.castCapsuleDirectShadow = 1 as never), RangeError)
  assert.throws(() => (body.capsuleIndirectShadowMinVisibility = 2), RangeError)
  assert.throws(() => (body.shadowCapsules = [{ ...SPHERE, radius: 0 }]), RangeError)
  assert.throws(
    () =>
      (body.shadowCapsules = [
        { bone: 'a', kind: 'capsule', center: [0, 0, 0], radius: 1 },
      ] as never),
    RangeError,
  )
  assert.equal(body.castCapsuleDirectShadow, false)
})

test('the shadow body is held frozen and copied with the node', () => {
  const body = object.mesh(geometry.box(1, 1, 1))
  body.castCapsuleDirectShadow = true
  body.capsuleIndirectShadowMinVisibility = 0.5
  body.shadowCapsules = [
    SPHERE,
    {
      bone: 'arm',
      kind: 'capsule',
      center: [0, 0, 0],
      radius: 0.05,
      length: 0.3,
      rotation: [0, 0, 0, 1],
    },
  ]
  assert.ok(Object.isFrozen(body.shadowCapsules))
  const other = object.mesh(geometry.box(1, 1, 1))
  other.copy(body)
  assert.equal(other.castCapsuleDirectShadow, true)
  assert.equal(other.capsuleIndirectShadowMinVisibility, 0.5)
  assert.equal(other.shadowCapsules.length, 2)
  other.copy(object.mesh(geometry.box(1, 1, 1)))
  assert.deepEqual(other.shadowCapsules, [], 'a copy of a default node is back to none')
})
