// What a ray of the run-time proxy brings back, the shipped WGSL run as JavaScript: the emission and the
// lit tint of the first opaque surface, the light a blended one lets through, the reach of a deformed
// placement against the footprint, and a ray that spends its budget.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { RAY_SPREAD_FLOOR, SURFACE_BLENDED } from './runtimeLayout.ts'
import { NO_SKY, along, ahead, origin, runOver } from './runtimeRun.fixture.ts'
import { world } from './runtimeScene.fixture.ts'
import { SKY_SLOT } from '../../../../../sdk-core/src/scene/core/environmentSky.ts'

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
  // The frame word's high half is the reach as a half float: 1 metre (0x3c00), in the instance's
  // mark (`INSTANCE.mark`).
  w.worlds.set('Instance', 0, [0, 0, 0, 0x3c00 << 16])
  const run = runOver(w)
  // The solid is opaque whatever its deformation: the ray stops on its front face, 3.5 metres out,
  // and the reach takes confidence alone — the footprint `spread` against it,
  // `spread / (spread + 1)`.
  const known = (tangent: number) => {
    const spread = 3.5 * tangent + RAY_SPREAD_FLOOR
    return spread / (spread + 1)
  }
  // A hundredth of a metre per metre: 0.045 wide against a metre of reach.
  const narrow = run.rtRadiance(origin, ahead, 1000, 0.01)
  assert.equal(narrow.distance, 3.5, 'stopped on the front face')
  assert.ok(Math.abs(narrow.confidence - known(0.01)) < 1e-6, `${narrow.confidence}`)
  // A lobe wide as it is long: the footprint is wider than the reach, the hit holds most of it.
  const wide = run.rtRadiance(origin, ahead, 1000, 1).confidence
  assert.ok(Math.abs(wide - known(1)) < 1e-6 && wide > 10 * narrow.confidence, `${wide}`)
})

test('a ray that spends its budget answers nothing, never a miss that darkens', () => {
  // Four hundred cubes in a row the ray crosses: the budget runs out before the tree does.
  const count = 400
  const places = Array.from({ length: count }, (_, k) =>
    new Matrix4().makeTranslation(k * 0.02 + 1, 0, 0),
  )
  const w = world(count, 1, { places, surfaces: [[0, 0, 0, 0.0001, 1, 1, 1, SURFACE_BLENDED]] })
  const seen = runOver(w).rtRadiance(origin, ahead, 1000, 0.01)
  assert.equal(seen.confidence, 0)
  assert.deepEqual(seen.color, [0, 0, 0])
})

/** A light buffer whose sky light gives the probes the flat sky `upper`, black below the horizon. */
const skyLit = (upper: number[]) => {
  const sky = NO_SKY.sky.map((slot) => [...slot])
  sky[SKY_SLOT.upper] = [...upper, 1]
  sky[SKY_SLOT.lower] = [0, 0, 0, 1]
  return { ...NO_SKY, sky }
}

test('a probe ray that leaves the scene reaches the sky its sky light gives, none without one', () => {
  const w = world(2, 1, { places: along(2, 4) })
  const up: [number, number, number] = [0, 1, 0]
  // Nothing in the way: the sky above, the ground's black below, the reach where it meets nothing.
  const lit = runOver(w, skyLit([0.2, 0.4, 0.8]))
  assert.deepEqual(lit.rtProbeRay(origin, up, 1000), [0.2, 0.4, 0.8, 1000])
  assert.deepEqual(lit.rtProbeRay(origin, [0, -1, 0], 1000), [0, 0, 0, 1000])
  // The atmosphere shows its sky to the reflections only: a probe ray reaches none of it.
  const sky = skyLit([0.2, 0.4, 0.8])
  sky.sky[SKY_SLOT.upper][3] = 0
  assert.deepEqual(runOver(w, sky).rtProbeRay(origin, up, 1000), [0, 0, 0, 1000])
})

test('a probe ray reaches the sky for the share of it the scene lets through, no more', () => {
  const sky = [0.2, 0.4, 0.8]
  // An opaque surface in the way: its lit tint, none of the sky behind it.
  const opaque = world(2, 1, { places: along(2, 4), surfaces: [[0.5, 0.25, 0, 1, 0, 0, 0, 0]] })
  const hit = runOver(opaque, skyLit(sky)).rtProbeRay(origin, ahead, 1000)
  assert.deepEqual(hit, [0.5, 0.25, 0, 3.5])
  // A blended solid stops three quarters of the ray, its two faces half each: the sky has the rest.
  const glass = world(1, 1, {
    places: along(1, 4),
    surfaces: [[0.8, 0.4, 0.2, 0.5, 0, 0, 0, SURFACE_BLENDED]],
  })
  const seen = runOver(glass, skyLit(sky)).rtProbeRay(origin, ahead, 1000)
  const want = [0.8, 0.4, 0.2].map((tint, i) => 0.75 * tint + 0.25 * sky[i])
  seen.slice(0, 3).forEach((c, i) => assert.ok(Math.abs(c - want[i]) < 1e-6, `${seen}`))
  assert.equal(seen[3], 3.5, 'the distance is the first surface’s')
})

test('a probe ray leaves the surface it hit, where and which way it faces, for the probe to mark; a read ray and a miss leave none', () => {
  const opaque = world(2, 1, { places: along(2, 4), surfaces: [[0.5, 0.25, 0, 1, 0, 0, 0, 0]] })
  const run = runOver(opaque, skyLit([0.2, 0.4, 0.8]))
  // The front face of the first cube, 3.5 metres out, looks back at the origin.
  run.rtProbeRay(origin, ahead, 1000)
  assert.deepEqual(run.testHit(), [3.5, 0, 0, 1])
  assert.deepEqual(run.testHitNormal(), [-1, 0, 0])
  // Each ray begins with nothing hit: a ray that finds nothing, a reflection's (read) ray, leave none.
  run.rtProbeRay(origin, [-1, 0, 0], 1000)
  assert.deepEqual(run.testHit(), [0, 0, 0, 0], 'a miss')
  run.rtProbeRay(origin, ahead, 1000)
  run.rtRadiance(origin, ahead, 1000, 0.01)
  assert.deepEqual(run.testHit(), [0, 0, 0, 0], 'a read ray marks nothing')
})
