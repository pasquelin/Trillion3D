// The words of a scene query and of its hit (`layout.ts` CAST_AT, HIT_AT), written and read by the one
// owner each: `raycast.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAST,
  CAST_AT,
  CAST_STOP,
  CAST_WORDS,
  HIT_AT,
  HIT_WORDS,
} from '../../../sdk-core/src/physics/layout.ts'
import { hitFloat, writeCast, writeShapeExtents } from './raycast.ts'

test('a shape’s sizes are written from the word asked: a radius, half extents, a half height then a radius', () => {
  const floats = new Float32Array(8)
  writeShapeExtents(floats, 2, { type: 'sphere', radius: 0.5 })
  assert.deepEqual([...floats.slice(2, 5)], [0.5, 0, 0])
  writeShapeExtents(floats, 1, { type: 'box', halfExtents: { x: 1, y: 2, z: 3 } })
  assert.deepEqual([...floats.slice(1, 4)], [1, 2, 3])
  writeShapeExtents(floats, 4, { type: 'capsule', halfHeight: 1.5, radius: 0.25 })
  assert.deepEqual([...floats.slice(4, 6)], [1.5, 0.25])
})

test('a cast query is a ray or a swept shape from its origin, stopped by its channel unless the types say', () => {
  const words = new Uint32Array(CAST_WORDS)
  const floats = new Float32Array(words.buffer)
  writeCast(words, [1, 2, 3], [0, 0, -1], 10, 7, { type: 'sphere', radius: 0.5 })
  assert.equal(words[CAST_AT.kind], CAST.sphere)
  assert.deepEqual([...floats.slice(CAST_AT.origin, CAST_AT.origin + 3)], [1, 2, 3])
  assert.deepEqual([...floats.slice(CAST_AT.travel, CAST_AT.travel + 3)], [0, 0, -10])
  assert.equal(floats[CAST_AT.extents], 0.5)
  assert.equal(words[CAST_AT.ignored], 7)
  assert.equal(words[CAST_AT.stop], CAST_STOP.channel, 'the types are the caller’s to ask for')
  assert.ok(CAST_AT.stop < CAST_WORDS)
})

test('a hit’s numbers are read from the words it lies at', () => {
  const hit = new Uint32Array(HIT_WORDS)
  const floats = new Float32Array(hit.buffer)
  hit[HIT_AT.body] = 5
  floats.set([0.25, 1, 2, 3, 0, 1, 0], HIT_AT.fraction)
  assert.equal(hitFloat(hit, HIT_AT.fraction), 0.25)
  assert.deepEqual(
    [0, 1, 2].map((k) => hitFloat(hit, HIT_AT.point + k)),
    [1, 2, 3],
  )
  assert.deepEqual(
    [0, 1, 2].map((k) => hitFloat(hit, HIT_AT.normal + k)),
    [0, 1, 0],
  )
})
