// The origins the cache keeps its cards for (`addStreamingViewOrigins`): a streaming view's eye is kept only when it lies
// the threshold or more from the eyes held, and the list stops at two; the main view's own (`viewOriginOf`) is its eye moved
// by the camera's velocity offset, or held where it stopped.
import test from 'node:test'
import assert from 'node:assert/strict'
import { SURFACE_CACHE_RULES } from '../../contracts/surfaceCacheOptions.ts'
import type { GlobalDistanceFieldSettings } from '../../contracts/globalDistanceFieldOptions.ts'
import { addStreamingViewOrigins, createViewOriginHold, viewOriginOf } from './requests.ts'
import type { Vec3 } from './cardTypes.ts'

const THRESHOLD = SURFACE_CACHE_RULES.surfaceCacheViewOriginDistanceThreshold.default

test('the threshold is a metre by default and two eyes are held at most', () => {
  assert.equal(THRESHOLD, 100)
  const held: Vec3[] = [[0, 0, 0]]
  addStreamingViewOrigins(
    held,
    [
      [200, 0, 0],
      [400, 0, 0],
      [600, 0, 0],
    ],
    THRESHOLD,
  )
  assert.equal(held.length, 2)
})

test('an eye nearer than the threshold to one held is left out, one at the threshold is kept', () => {
  const near: Vec3[] = [[0, 0, 0]]
  addStreamingViewOrigins(near, [[99, 0, 0]], THRESHOLD)
  assert.deepEqual(near, [[0, 0, 0]])
  const far: Vec3[] = [[0, 0, 0]]
  addStreamingViewOrigins(far, [[100, 0, 0]], THRESHOLD)
  assert.deepEqual(far, [
    [0, 0, 0],
    [100, 0, 0],
  ])
})

test('an eye is compared with the streaming eyes already kept, and the list stops at the most', () => {
  const origins: Vec3[] = [[0, 0, 0]]
  addStreamingViewOrigins(
    origins,
    [
      [50, 0, 0],
      [500, 0, 0],
      [530, 0, 0],
      [9000, 0, 0],
    ],
    THRESHOLD,
  )
  assert.deepEqual(origins, [
    [0, 0, 0],
    [500, 0, 0],
  ])
})

test('a list already full takes nothing', () => {
  const origins: Vec3[] = [
    [0, 0, 0],
    [1000, 0, 0],
  ]
  addStreamingViewOrigins(origins, [[5000, 0, 0]], THRESHOLD)
  assert.equal(origins.length, 2)
})

// The clipmap `index` of this field has a half side of 2500 · 2^index centimetres.
const FIELD = {
  globalDistanceFieldViewDistance: 20000,
  globalDistanceFieldClipmapExponent: 2,
} as GlobalDistanceFieldSettings
const out = (): [number, number, number] => [0, 0, 0]

test('the main view’s origin is its eye moved by the velocity offset', () => {
  const origin = viewOriginOf(
    out(),
    [10, 20, 30],
    [1, 2, 3],
    createViewOriginHold(),
    true,
    3,
    FIELD,
  )
  assert.deepEqual(origin, [11, 22, 33])
})

test('past the first clipmap the offset is held within three quarters of its extent, each axis; the first is not held', () => {
  // Clipmap 1: 5000 across, 3750 of drift.
  const held = viewOriginOf(
    out(),
    [0, 0, 0],
    [9000, -9000, 100],
    createViewOriginHold(),
    true,
    1,
    FIELD,
  )
  assert.deepEqual(held, [3750, -3750, 100])
  const first = viewOriginOf(
    out(),
    [0, 0, 0],
    [9000, -9000, 100],
    createViewOriginHold(),
    true,
    0,
    FIELD,
  )
  assert.deepEqual(first, [9000, -9000, 100])
  const none = viewOriginOf(out(), [0, 0, 0], [9000, 0, 0], createViewOriginHold(), true, -1, FIELD)
  assert.deepEqual(none, [9000, 0, 0])
})

test('while the origin is not updated it stays where the eye was when it stopped, without the offset, and follows again when updated', () => {
  const hold = createViewOriginHold()
  assert.deepEqual(viewOriginOf(out(), [1, 1, 1], [5, 0, 0], hold, true, 3, FIELD), [6, 1, 1])
  assert.deepEqual(viewOriginOf(out(), [2, 2, 2], [5, 0, 0], hold, false, 3, FIELD), [2, 2, 2])
  assert.deepEqual(viewOriginOf(out(), [9, 9, 9], [5, 0, 0], hold, false, 3, FIELD), [2, 2, 2])
  assert.deepEqual(viewOriginOf(out(), [9, 9, 9], [5, 0, 0], hold, true, 3, FIELD), [14, 9, 9])
  assert.deepEqual(viewOriginOf(out(), [4, 4, 4], [0, 0, 0], hold, false, 3, FIELD), [4, 4, 4])
})
