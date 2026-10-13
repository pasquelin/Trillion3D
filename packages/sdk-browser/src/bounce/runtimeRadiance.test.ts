// What a ray of the run-time proxy brings back, the shipped WGSL run as JavaScript: the emission and the
// lit tint of the first opaque surface, the light a blended one lets through, the reach of a deformed
// placement against the footprint, and a ray that spends its budget.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { SURFACE_BLENDED } from './runtimeLayout.ts'
import { along, ahead, origin, runOver } from './runtimeRun.fixture.ts'
import { world } from './runtimeScene.fixture.ts'

test('a ray returns the emission and the lit tint of the first opaque surface it meets', () => {
  // One surface: tint (0.5, 0.25, 0), emission (3, 2, 1), opaque.
  const w = world(2, 1, { places: along(2, 4), surfaces: [[0.5, 0.25, 0, 1, 3, 2, 1, 0]] })
  const seen = runOver(w).rtRadiance(origin, ahead, 1000, 0.01)
  assert.deepEqual(seen.color, [3.5, 2.25, 1])
  assert.equal(seen.confidence, 1)
})

test('a blended surface lets the light behind it through: its opacity weighs its own radiance', () => {
  // The front cube blended at one half, emitting (4, 0, 0); the cube behind it opaque, emitting (0, 8, 0).
  // A closed solid has two faces: the ray meets its front, then its back, then the cube behind.
  const w = world(2, 1, {
    places: along(2, 4),
    surfaces: [
      [0, 0, 0, 0.5, 4, 0, 0, SURFACE_BLENDED],
      [0, 0, 0, 1, 0, 8, 0, 0],
    ],
    surfaceOf: (placement) => placement,
  })
  const seen = runOver(w).rtRadiance(origin, ahead, 1000, 0.01)
  assert.deepEqual(
    seen.color.map((c) => Math.round(c * 1e4) / 1e4),
    [3, 2, 0],
  )
  assert.equal(seen.confidence, 1)
  // A blended solid alone stops three quarters of the ray, its two faces half each: the rest is the next stage's.
  const alone = world(1, 1, {
    places: along(1, 4),
    surfaces: [[0, 0, 0, 0.5, 4, 0, 0, SURFACE_BLENDED]],
  })
  const half = runOver(alone).rtRadiance(origin, ahead, 1000, 0.01)
  assert.deepEqual(half.color, [4, 0, 0])
  assert.equal(half.confidence, 0.75)
})

test('a ray that finds nothing holds nothing: confidence zero, for the next stage', () => {
  const w = world(2, 1, { places: along(2, 4) })
  const seen = runOver(w).rtRadiance(origin, [-1, 0, 0], 1000, 0.01)
  assert.equal(seen.confidence, 0)
  assert.deepEqual(seen.color, [0, 0, 0])
})

test('a deformed placement is met at its rest shape, its reach taking confidence from a hit narrower than it', () => {
  const w = world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 1, 1, 1, 0]] })
  // The frame word's high half is the reach as a half float: 1 metre (0x3c00).
  w.header.words[3] = 0x3c00 << 16
  const run = runOver(w)
  // A ray's footprint at 4 metres, a hundredth of a metre per metre: 0.05 wide against a metre of reach,
  // on each of the solid's two faces.
  const narrow = run.rtRadiance(origin, ahead, 1000, 0.01).confidence
  assert.ok(narrow < 0.1 && narrow > 0.03, `${narrow}`)
  // A lobe wide as it is long: the footprint is wider than the reach, the hit holds.
  const wide = run.rtRadiance(origin, ahead, 1000, 1).confidence
  assert.ok(wide > 0.8 && wide > 10 * narrow, `${wide}`)
})

test('a ray that spends its budget answers nothing, never a miss that darkens', () => {
  // Four hundred cubes in a row the ray crosses: the budget runs out before the tree does.
  const count = 400
  const places = Array.from({ length: count }, (_, k) => {
    const m = new G.Matrix4()
    m.elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, k * 0.02 + 1, 0, 0, 1])
    return m
  })
  const w = world(count, 1, { places, surfaces: [[0, 0, 0, 0.0001, 1, 1, 1, SURFACE_BLENDED]] })
  const seen = runOver(w).rtRadiance(origin, ahead, 1000, 0.01)
  assert.equal(seen.confidence, 0)
  assert.deepEqual(seen.color, [0, 0, 0])
})
