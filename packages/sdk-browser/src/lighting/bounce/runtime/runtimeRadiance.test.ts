// What a ray of the run-time proxy brings back, the shipped WGSL run as JavaScript: the emission and the
// lit tint of the first opaque surface, the light a blended one lets through, the reach of a deformed
// placement against the footprint, a ray that spends its budget, and a walk cut into rings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { RAY_SPREAD_FLOOR, RAY_WORK, SURFACE_BLENDED } from './runtimeLayout.ts'
import { NO_SKY, along, ahead, origin, runOver, type RtRings } from './runtimeRun.fixture.ts'
import { fitRoot, joinedCubes, world } from './runtimeScene.fixture.ts'

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

/** Four hundred cubes in a row a ray along `ahead` crosses: its budget runs out before the tree does. */
const crowd = () => {
  const count = 400
  const places = Array.from({ length: count }, (_, k) =>
    new Matrix4().makeTranslation(k * 0.02 + 1, 0, 0),
  )
  return world(count, 1, { places, surfaces: [[0, 0, 0, 0.0001, 1, 1, 1, SURFACE_BLENDED]] })
}

test('a reflection’s ray that spends its budget answers nothing, never a miss that darkens', () => {
  const seen = runOver(crowd()).rtRadiance(origin, ahead, 1000, 0.01)
  assert.equal(seen.confidence, 0)
  assert.deepEqual(seen.color, [0, 0, 0])
})

test('a probe’s ray that spends its walk ends as a hit where the walk stopped, its weight kept', () => {
  // Four hundred cubes one on another: the ray meets the front face at 2.5 and every box on it, so the
  // walk spends the probe's budget (cut to 512 units here) with nothing more to learn. It is neither
  // dropped nor a miss: it brings the light the cascades hold where it stopped (the stub reads a surface
  // of no tint as its light, one), at the distance the walk had reached.
  const places = Array.from({ length: 400 }, () => new Matrix4().makeTranslation(3, 0, 0))
  const stacked = world(400, 1, { places })
  const run = runOver(stacked, NO_SKY, { RT_PROBE_WORK: RAY_WORK })
  assert.deepEqual(run.rtProbeRay(origin, ahead, 1000), [1, 1, 1, 2.5])
  assert.equal(run.testCause(), 1, 'the walk spent its units')
  assert.equal(run.testReached(), 2.5)
  assert.equal(run.testShadowCause(), 0, 'no shadow ray was cast')
  // The reflections' own budget under the same walk answers nothing, the next stage's.
  assert.equal(runOver(stacked).rtRadiance(origin, ahead, 1000, 0.01).confidence, 0)
  // Given the whole walk the ray ends where the exhausted one did: the same hit.
  const whole = runOver(stacked, NO_SKY, { RT_PROBE_WORK: 1e5, RT_PROBE_TRIANGLES: 1e5 })
  assert.deepEqual(whole.rtProbeRay(origin, ahead, 1000), [1, 1, 1, 2.5])
  assert.equal(whole.testCause(), 0)
  // A probe inside the boxes (four hundred cubes scaled to twenty, the origin within each) enters them at
  // zero: its exhausted ray ends at the surface it had found, ten metres out and of its tint as the whole walk
  // finds it, never at a distance of zero, which would bury the probe, nor of no tint.
  const around = world(400, 1, {
    places: Array.from({ length: 400 }, () => new Matrix4().makeScale(20, 20, 20)),
    surfaces: [[0.5, 0.25, 0, 1, 0, 0, 0, 0]],
  })
  const spentInside = runOver(around, NO_SKY, { RT_PROBE_WORK: RAY_WORK })
  const stopped = spentInside.rtProbeRay(origin, ahead, 1000)
  assert.equal(spentInside.testCause(), 1, 'the walk spent its units')
  assert.equal(spentInside.testReached(), 0, 'the origin lies in every box')
  const wholeInside = runOver(around, NO_SKY, { RT_PROBE_WORK: 1e5, RT_PROBE_TRIANGLES: 1e5 })
  const found = wholeInside.rtProbeRay(origin, ahead, 1000)
  assert.ok(Math.abs(found[3] - 10) < 1e-9, `${found}`)
  assert.deepEqual(stopped, found, 'the exhausted ray ends where the whole walk finds the surface')
  assert.deepEqual(stopped.slice(0, 3), [0.5, 0.25, 0])
})

/** One placement of one mesh, two cubes three metres either side of its origin: the box of the placement holds the
 *  origin, the boxes of the mesh's leaves (a cube's faces each) do not. The placements are tried in turn. */
const barbell = () =>
  joinedCubes([
    [-3, 0, 0],
    [3, 0, 0],
  ])

test('a probe’s ray that spends its walk before it finds a surface ends in the placement it had reached', () => {
  // The origin lies in the box of the placement, in the box of neither leaf: the ray, a little off the x axis,
  // meets the near cube's leaf at about 2.49 m and is allowed one triangle test, which it spends without a hit.
  const apart = barbell()
  const aim: Vec3 = [Math.cos(0.05), Math.sin(0.05), 0]
  const found = runOver(apart, NO_SKY).rtProbeRay(origin, aim, 1000)
  assert.deepEqual(found.slice(0, 3), [0.5, 0.25, 0], 'the whole walk finds the surface')
  const run = runOver(apart, NO_SKY, { RT_PROBE_TRIANGLES: 1 })
  const stopped = run.rtProbeRay(origin, aim, 1000)
  assert.equal(run.testCause(), 2, 'the walk spent its triangle tests')
  assert.ok(stopped[3] > 2.4 && stopped[3] < found[3], `${stopped[3]} m, where the walk was`)
  assert.deepEqual(
    stopped.slice(0, 3),
    [0.5, 0.25, 0],
    'the tint of the placement, not the white of none',
  )
  // A walk that spends its units before it enters a placement has reached none: no tint, no distance.
  assert.deepEqual(
    runOver(apart, NO_SKY, { RT_PROBE_WORK: 0 }).rtProbeRay(origin, aim, 1000),
    [1, 1, 1, 0],
  )
})

/** A sky light whose cube gives the probes the flat sky `upper`, black below the horizon. */
const skyLit = (upper: number[]) => ({
  skyLightApplied: () => true,
  skyLightRay: (d: number[]) => (d[1] < 0 ? [0, 0, 0] : upper),
})

test('a probe ray that leaves the scene reaches the sky its sky light gives, none without one', () => {
  const w = world(2, 1, { places: along(2, 4) })
  const up: [number, number, number] = [0, 1, 0]
  // Nothing in the way: the sky above, the ground's black below, the reach where it meets nothing.
  const lit = runOver(w, NO_SKY, skyLit([0.2, 0.4, 0.8]))
  assert.deepEqual(lit.rtProbeRay(origin, up, 1000), [0.2, 0.4, 0.8, 1000])
  assert.deepEqual(lit.rtProbeRay(origin, [0, -1, 0], 1000), [0, 0, 0, 1000])
  // The atmosphere shows its sky to the reflections only: a probe ray reaches none of it.
  assert.deepEqual(runOver(w).rtProbeRay(origin, up, 1000), [0, 0, 0, 1000])
})

test('a probe ray reaches the sky for the share of it the scene lets through, no more', () => {
  const sky = [0.2, 0.4, 0.8]
  // An opaque surface in the way: its lit tint, none of the sky behind it.
  const opaque = world(2, 1, { places: along(2, 4), surfaces: [[0.5, 0.25, 0, 1, 0, 0, 0, 0]] })
  const hit = runOver(opaque, NO_SKY, skyLit(sky)).rtProbeRay(origin, ahead, 1000)
  assert.deepEqual(hit, [0.5, 0.25, 0, 3.5])
  // A blended solid stops three quarters of the ray, its two faces half each: the sky has the rest.
  const glass = world(1, 1, {
    places: along(1, 4),
    surfaces: [[0.8, 0.4, 0.2, 0.5, 0, 0, 0, SURFACE_BLENDED]],
  })
  const seen = runOver(glass, NO_SKY, skyLit(sky)).rtProbeRay(origin, ahead, 1000)
  const want = [0.8, 0.4, 0.2].map((tint, i) => 0.75 * tint + 0.25 * sky[i])
  seen.slice(0, 3).forEach((c, i) => assert.ok(Math.abs(c - want[i]) < 1e-6, `${seen}`))
  assert.equal(seen[3], 3.5, 'the distance is the first surface’s')
})

/** The rings of a walk: `ends`, each ring's `work` units, `begins` where each may enter at the soonest, and a detail
 *  window `detail` (end, fade by the eye's distance, noise, beginning) on a budget of its own. */
const ringed = (
  ends: number[],
  work: number,
  detail: number[] = [0, 0, 0, 0],
  detailWork = 0,
  begins: number[] = [],
): RtRings => ({
  begins: [...begins, 0, 0, 0, 0].slice(0, 4),
  ends: [...ends, 0, 0, 0].slice(0, 4),
  count: ends.length,
  work,
  tests: 1e6,
  on: true,
  detail,
  detailWork,
  detailTests: 1e6,
})
const BIG = 1e6
type Run = ReturnType<typeof runOver>
/** The walk of a ray along +x over `rings`, a reflection's, its own budgets in the rings alone. */
const through = (run: Run, rings: RtRings) =>
  run.rtLayersOver(origin, ahead, 1000, 0.01, 0, 0, false, rings)
const CUBES = { places: along(2, 4), surfaces: [[0.5, 0.25, 0, 1, 3, 2, 1, 0]] }

test('a ring that spends its budget having found a surface keeps it; a walk without rings still answers nothing', () => {
  const run = runOver(world(2, 1, CUBES))
  // A budget of exactly the units the walk spends to meet the first cube is spent as it ends.
  run.rtRadiance(origin, ahead, 1000, 0.01)
  const units = run.testOwnWork()
  const alone = run.rtLayersOver(origin, ahead, 1000, 0.01, units, BIG, false, run.rtNoRings())
  assert.equal(alone.answer.confidence, 0, 'one walk: spent is nothing')
  const kept = through(run, ringed([1000], units))
  assert.deepEqual(kept.answer.color, [3.5, 2.25, 1])
  assert.deepEqual([kept.answer.confidence, kept.answer.distance, kept.spent], [1, 3.5, 1])
  assert.equal(kept.work, units)
})

test('the rings are walked in order, the nearest surface of the first that holds one answers, a spent one is skipped', () => {
  const run = runOver(world(2, 1, CUBES))
  // The first cube lies at 3.5, in the second ring.
  const two = through(run, ringed([3, 1000], BIG))
  assert.deepEqual([two.answer.distance, two.answer.confidence, two.spent], [3.5, 1, 0])
  // A cube just past the boundary: the seam lets none through, the front face answers.
  const edge = runOver(world(1, 1, { places: along(1, 4) }))
  const seam = through(edge, ringed([3.5 - 5e-5, 1000], BIG))
  assert.ok(Math.abs(seam.answer.distance - 3.5) < 1e-6, `${seam.answer.distance}: the front face`)
  // Every ring spends its one unit having met nothing: all are skipped, the ray leaves through the end.
  const skipped = through(run, ringed([3, 1000], 1))
  assert.deepEqual([skipped.spent, skipped.answer.confidence, skipped.open], [1, 0, 1])
})

test('a detail window that spends its budget is a hit where it stopped, by noise against the fade; else the rings go on', () => {
  const run = runOver(world(2, 1, CUBES))
  const detail = (noise: number, fade = 0) =>
    through(run, ringed([1000], BIG, [2, fade, noise, 0], 1))
  // One unit: spent before any placement was entered, a surface of no tint where it stopped.
  const stopped = detail(0.5)
  assert.deepEqual(stopped.answer.color, [1, 1, 1])
  assert.deepEqual([stopped.answer.confidence, stopped.answer.distance, stopped.spent], [1, 0, 1])
  // Faded out (fade not under the noise): the rings find the cube.
  const faded = detail(0.5, 0.5)
  assert.deepEqual(faded.answer.color, [3.5, 2.25, 1])
})

test('a surface the detail window finds is taken by noise against the fade of the window’s last third, else the rings go on past it', () => {
  // The front of the cube at 1.75 of a window of 2: fade (1.75 − 1.4) / 0.6 = 0.583. The one ring ends at 1.6.
  const run = runOver(world(1, 1, { ...CUBES, places: along(1, 2.25) }))
  const seen = (noise: number) => through(run, ringed([1.6], BIG, [2, 0, noise, 0], BIG))
  assert.equal(seen(0.9).answer.distance, 1.75, 'fade under the noise: a hit')
  const refused = seen(0.3)
  assert.deepEqual([refused.answer.confidence, refused.open], [0, 1], 'refused: rings go on')
  // A window whose ring covers the surface finds it again.
  assert.equal(through(run, ringed([1000], BIG, [2, 0, 0.3, 0], BIG)).answer.distance, 1.75)
})

test('a detail window is not walked for a surface 40 metres from the eye, and begins where the screen left the ray', () => {
  const run = runOver(world(2, 1, CUBES))
  const faraway = through(run, ringed([1000], BIG, [2, 1, 0.5, 0], 1))
  assert.equal(faraway.work, through(run, ringed([1000], BIG)).work, 'no unit spent in the window')
  // The cube’s front at 0.5, its back at 1.5: a window begun at 0.6, the ray already inside it, meets the back.
  const near = runOver(world(1, 1, { ...CUBES, places: along(1, 1) }))
  assert.equal(through(near, ringed([1000], BIG, [2, 0, 1, 0], BIG)).answer.distance, 0.5)
  assert.equal(through(near, ringed([1000], BIG, [2, 0, 1, 0.6], BIG)).answer.distance, 1.5)
})

test('a ring is not walked outside the box of the tree’s root, and enters where its beginning lets it', () => {
  // Seventy cubes, a tree: a ring over the metres before the first costs nothing.
  const crowded = world(70, 1, { places: along(70, 4) })
  fitRoot(crowded, [3.5, -0.5, -0.5], [280.5, 0.5, 0.5])
  const run = runOver(crowded)
  const whole = through(run, ringed([1000], BIG))
  const before = through(run, ringed([2, 1000], BIG))
  assert.deepEqual([before.answer.distance, before.work], [3.5, whole.work])
  // Entered past the first cube’s front, at 5, its back at 4.5 behind it: the second cube’s front answers.
  const past = through(run, ringed([1000], BIG, [0, 0, 0, 0], 0, [5]))
  assert.equal(past.answer.distance, 7.5)
})
