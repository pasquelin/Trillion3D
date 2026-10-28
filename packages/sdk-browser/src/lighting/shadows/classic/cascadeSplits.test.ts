import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SUN_CASCADES,
  cascadeCount,
  cascadeRange,
  type SunCascadeSettings,
  type ViewCascadeSettings,
} from './cascadeSplits.ts'
import { accumulatedScale } from '../../../../../sdk-core/src/contracts/sunCascades.ts'

const VIEW: ViewCascadeSettings = {
  distanceScale: 1,
  maxCascades: 10,
  transitionScale: 1,
  near: 10,
}

/** Where split `index` lies, as the ranges of the cascades give it: the near of the cascade it begins, the far of the last for the end. */
const splitDistance = (sun: SunCascadeSettings, view: ViewCascadeSettings, index: number) => {
  const count = cascadeCount(sun, view)
  return index < count
    ? cascadeRange(sun, view, index).near
    : cascadeRange(sun, view, count - 1).far
}

test('the cascades take each three times the one before: 1, 3, 9, 27 of 40', () => {
  assert.equal(accumulatedScale(3, 0, 4), 0)
  assert.equal(accumulatedScale(3, 1, 4), 1 / 40)
  assert.equal(accumulatedScale(3, 2, 4), 4 / 40)
  assert.equal(accumulatedScale(3, 3, 4), 13 / 40)
  assert.equal(accumulatedScale(3, 4, 4), 1)
  assert.equal(accumulatedScale(1, 2, 4), 0.5)
})

test("the splits run from the view's near plane to the sun's distance", () => {
  assert.equal(splitDistance(DEFAULT_SUN_CASCADES, VIEW, 0), 10)
  assert.equal(splitDistance(DEFAULT_SUN_CASCADES, VIEW, 4), 40000)
  assert.equal(splitDistance(DEFAULT_SUN_CASCADES, VIEW, 1), 10 + 39990 / 40)
})

test("the view's distance scale is held to 0..2, its cascade count holds the sun's, and none reaches nothing", () => {
  assert.equal(splitDistance(DEFAULT_SUN_CASCADES, { ...VIEW, distanceScale: 5 }, 4), 80000)
  assert.equal(cascadeCount(DEFAULT_SUN_CASCADES, { ...VIEW, maxCascades: 2 }), 2)
  assert.equal(cascadeCount(DEFAULT_SUN_CASCADES, { ...VIEW, maxCascades: 0 }), 0)
  assert.equal(cascadeCount(DEFAULT_SUN_CASCADES, { ...VIEW, distanceScale: 0 }), 0)
})

test('a cascade grows by its fade into the next; the last fades in place', () => {
  const first = cascadeRange(DEFAULT_SUN_CASCADES, VIEW, 0)
  const length = splitDistance(DEFAULT_SUN_CASCADES, VIEW, 1) - 10
  assert.ok(Math.abs(first.fadePlane - (10 + length)) < 1e-9)
  assert.ok(Math.abs(first.far - (first.fadePlane + length * 0.1)) < 1e-9)
  assert.equal(first.nearFadeLength, 0)
  const last = cascadeRange(DEFAULT_SUN_CASCADES, VIEW, 3)
  assert.equal(last.far, 40000)
  assert.ok(Math.abs(last.fadePlane - (40000 - (40000 - last.near) * 0.1)) < 1e-6)
  const second = cascadeRange(DEFAULT_SUN_CASCADES, VIEW, 1)
  assert.ok(Math.abs(second.nearFadeLength - length * 0.1) < 1e-9)
  // No transition: the fade has no length.
  assert.equal(cascadeRange(DEFAULT_SUN_CASCADES, { ...VIEW, transitionScale: 0 }, 1).fadeLength, 0)
})
