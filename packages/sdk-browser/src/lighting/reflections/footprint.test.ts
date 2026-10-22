// The reflection over whole views, shipped WGSL run as JavaScript (`scene.fixture.ts`): a thin
// sheet over a plank at grazing angles, where no hit lies where the exact ray cast meets nothing or
// meets something farther, and the elliptical footprint a hit reads — one tap on a round lobe, taps
// along the long axis of a stretched one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_CONSTANTS, REFLECTION_COUNTS } from './constants.ts'
import { reflectionRunner, sceneFromDepth, sceneOver, viewOf } from './scene.fixture.ts'
import { depthField } from './depthField.fixture.ts'
import { camera, castBoxes, rasterize, type Box } from './boxes.fixture.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'

const TAPS = REFLECTION_CONSTANTS.REFLECTION_TAPS

/**
 * A sheet standing over a plank on a slab, the sheet a blended surface outside the depth — a pane
 * or a disc —, seen from around it at grazing angles: every hit its front face's mirror rays make
 * lies where the exact cast of the same boxes puts it, or past it, never where the cast meets
 * nothing or before it — save on a pixel that does not hold one plane alone (a silhouette or a
 * crease, within a pixel of it), whose surface the image does not tell.
 */
test('a thin sheet over a plank reflects no streak at grazing angles', () => {
  const ground: Box = { low: [-8, -0.2, -5], high: [8, 0, 5] },
    plank: Box = { low: [-3, 0, -0.4], high: [3, 0.12, 0.4] },
    sheet: Box = { low: [-1.2, 0.3, -0.02], high: [1.2, 2.2, 0.02] }
  const boxes = [ground, plank]
  const Wv = 192,
    Hv = 108
  let hits = 0
  for (const [azimuth, height] of [
    [0, 4.5],
    [25, 1.2],
    [50, 2.5],
    [60, 4],
    [70, 1.5],
    [-40, 0.8],
  ]) {
    const a = (azimuth * Math.PI) / 180
    const eye: Vec3 = [9 * Math.sin(a), height, 9 * Math.cos(a)]
    const view = camera(eye, [0, 0.8, 0], Wv, Hv, (50 * Math.PI) / 180)
    const scene = sceneOver(view, boxes)
    const onePlane = (x: number, y: number) => {
      const plane = scene.shown[y * Wv + x]
      for (let v = Math.max(0, y - 1); v <= Math.min(Hv - 1, y + 1); v++)
        for (let u = Math.max(0, x - 1); u <= Math.min(Wv - 1, x + 1); u++)
          if (scene.shown[v * Wv + u] !== plane) return false
      return true
    }
    for (let y = 0; y < Hv; y++)
      for (let x = 0; x < Wv; x++) {
        const d = view.ray(x + 0.5, y + 0.5)
        const front = castBoxes(eye, d, [sheet])
        if (!(front.t < castBoxes(eye, d, boxes).t)) continue
        const P = [0, 1, 2].map((k) => eye[k] + d[k] * front.t) as Vec3
        if (Math.abs(P[2] - sheet.high[2]) > 1e-9) continue
        const R: Vec3 = [d[0], d[1], -d[2]]
        const N: Vec3 = [0, 0, 1]
        const seen = scene.reflectionSeen(
          P,
          N,
          scene.reflectionLobeOf(R, 0.01, [0, 0, 0, 0.01]),
          scene.reflectionRayBias(P, N),
        ).answer
        if (!(seen.confidence > 0)) continue
        hits++
        const Q = seen.color
        if (!onePlane(Math.floor(Q[0]), Math.floor(Q[1]))) continue
        const exact = castBoxes(P, R, boxes, 1e-6).t
        assert.ok(
          Number.isFinite(exact),
          `${azimuth}° ${height}: a hit where nothing is, ${x},${y}`,
        )
        const S = view.project(P),
          T = view.project([0, 1, 2].map((k) => P[k] + R[k] * exact) as Vec3)
        const reached = Math.hypot(Q[0] - S[0], Q[1] - S[1]),
          truth = Math.hypot(T[0] - S[0], T[1] - S[1])
        assert.ok(reached > truth - 2, `${azimuth}° ${height}: a hit before the surface, ${x},${y}`)
      }
  }
  assert.ok(hits > 500, `${hits} hits`)
})

test('a round footprint is one tap at its level; a stretched one, taps along its long axis', () => {
  const view = camera([0, 1, 6], [0, 1, 0], 320, 180)
  // Each tap the footprint takes, as the point and level it reads.
  const read: number[][] = []
  const run = reflectionRunner(
    depthField(1, 1, [0]),
    viewOf(view.m, view.inverse, [...view.eye, 1], [320, 180]),
    {
      reflectionRadianceAt: (
        sum: { get: () => { color: number[]; weight: number } },
        uv: number[],
        level: number,
        share: number,
      ) => {
        const tap = [uv[0] * 320, uv[1] * 180, level, 1]
        read.push(tap)
        const taps = sum.get()
        taps.color = taps.color.map((v, k) => v + share * tap[k])
        taps.weight += share
      },
    },
  )
  const hit: Vec3 = [0, 1, 0],
    R: Vec3 = [0, 0, 1],
    Q = view.project(hit).slice(0, 2),
    pixel = view.project(hit)[3] * view.scale
  /** The footprint's taps from `P`, two metres or more from the hit, of `alpha` and `lobe`. */
  const taps = (P: Vec3, alpha: number, lobe: number[]) => {
    read.length = 0
    const ellipse = run.reflectionLobeOf(R, alpha, lobe)
    const cone = run.reflectionConeAt(Math.hypot(...hit.map((v, k) => v - P[k])), pixel, ellipse)
    const sum = run.reflectionFootprint(Q, hit, pixel, ellipse, cone, [0, 0, 320, 180], {
      pixel: [0, 0],
      plane: [0, 0, 0],
      thickness: 1,
    })
    return { mean: sum.color.map((v) => v / sum.weight), taps: [...read] }
  }
  const axis = (distance: number, alpha: number) =>
    (2 * distance * run.reflectionConeTangent(alpha)) / pixel
  // Round — its direction any —: one tap at Q, the level of the cone's diameter in pixels.
  const alpha = 0.04
  for (const lobe of [
    [0, 0, 0, alpha],
    [1, 0, 0, alpha],
  ]) {
    const round = taps([0, 1, 2], alpha, lobe)
    assert.equal(round.taps.length, 1)
    assert.deepEqual(round.taps[0].slice(0, 2), Q)
    assert.ok(Math.abs(round.mean[2] - Math.log2(axis(2, alpha))) < 1e-9)
  }
  // Twice as far, one level up: contact hardening.
  const far = taps([0, 1, 4], alpha, [0, 0, 0, alpha])
  assert.ok(Math.abs(far.mean[2] - Math.log2(axis(2, alpha)) - 1) < 1e-9)
  // Stretched along x: taps on the image's x axis, symmetric about Q, as many as the axes' ratio
  // asks up to the bound, at the short axis's level — or the long axis's share of a tap past it —,
  // their weights one each over their count.
  for (const stretch of [0.06, 0.08, 0.5]) {
    const { mean, taps: reads } = taps([0, 1, 2], alpha, [1, 0, 0, stretch])
    const short = axis(2, alpha),
      long = axis(2, stretch)
    assert.equal(reads.length, Math.min(Math.ceil(long / short), TAPS), `${stretch}`)
    assert.ok(
      reads.every((tap) => Math.abs(tap[1] - Q[1]) < 1e-9),
      'along x',
    )
    assert.ok(Math.abs(mean[0] - Q[0]) < 1e-9 && Math.abs(mean[1] - Q[1]) < 1e-9, `${mean}`)
    const width = Math.max(short, long / TAPS)
    assert.ok(Math.abs(mean[2] - Math.log2(width)) < 1e-9, `${stretch}: ${mean[2]}`)
    // The taps span the long axis less one tap's width, evenly.
    const xs = reads.map((tap) => tap[0]).sort((p, q) => p - q)
    const span = xs.at(-1)! - xs[0]
    assert.ok(
      Math.abs(span - ((long - width) * (reads.length - 1)) / reads.length) < 1e-6,
      `${span}`,
    )
  }
})

test('the screen is marched over a span of the ray alone: past a hit or short of it, nothing', () => {
  // A floor and a wall in front of it, seen from above the floor: the mirror ray of a floor point climbs to the wall.
  const wall: Box = { low: [-20, 0, -12], high: [20, 8, -11] }
  const floor: Box = { low: [-20, -0.2, -30], high: [20, 0, 30] }
  const view = camera([0, 2, 6], [0, 1, -10], 192, 108, (50 * Math.PI) / 180)
  const scene = sceneOver(view, [floor, wall])
  const P: Vec3 = [0, 0, 0],
    N: Vec3 = [0, 1, 0]
  const lobe = scene.reflectionLobeOf([0, 0.316, -0.949], 0.01, [0, 0, 0, 0.01])
  const bias = scene.reflectionRayBias(P, N)
  const whole = scene.reflectionSeen(P, N, lobe, bias)
  assert.ok(whole.answer.confidence > 0, 'the wall is seen')
  // The distance the strict march finds along the span, none where it meets nothing.
  const span = (start: number, stop: number) => {
    const ray = scene.reflectionRaySpan(P, N, lobe, bias, start, stop)
    const marched = scene.screenMarchOver(
      ray.o,
      ray.d,
      ray.end,
      scene.reflectionThickness(),
      scene.slab,
      50,
      true,
    )
    return marched.t < 0 ? undefined : scene.reflectionRayDistance(ray, marched.t)
  }
  // The wall lies about 11.6 along the ray: the whole ray finds it, and so does a span that brackets it.
  assert.ok(Math.abs(span(0, 1e9)! - whole.answer.distance) < 0.2, `${span(0, 1e9)}`)
  assert.ok(Math.abs(span(5, 1e9)! - whole.answer.distance) < 0.2, `${span(5, 1e9)}`)
  assert.equal(span(14, 1e9), undefined, 'a span that starts past the wall sees none')
  assert.equal(span(0, 8), undefined, 'a span that ends short of it sees none')
  // On a hit, where the screen stopped knowing the ray is the wall's distance.
  assert.equal(whole.left, whole.answer.distance)
})

test('the screen is looked at once more where the ray left the field, from the outermost cube’s exit drawn back by its steps’ jitter', () => {
  const wall: Box = { low: [-20, 0, -12], high: [20, 8, -11] }
  const floor: Box = { low: [-20, -0.2, -30], high: [20, 0, 30] }
  const view = camera([0, 2, 6], [0, 1, -10], 192, 108, (50 * Math.PI) / 180)
  const [field, views] = sceneFromDepth(view, rasterize(view, [floor, wall]).depth)
  // The far trace on (the scene's flags' third bit), 100 m long; a field of one cube, `half` from the origin each way.
  views.reflectionView.scene = [50, 0, 0, REFLECTION_COUNTS.REFLECTION_DISTANT_TRACES]
  views.reflectionView.reach = [0, 0, 0, 100]
  const run = (half: number) =>
    reflectionRunner(field, views, {
      bounce: {
        counts: [8, 1, 0, 1],
        levels: [{ base: [-4, -4, -4], spacing: half / 4 }],
        reach: [200, 0, 0, 0],
      },
    })
  const P: Vec3 = [0, 0, 0],
    N: Vec3 = [0, 1, 0]
  const far = (half: number) => {
    const scene = run(half)
    const lobe = scene.reflectionLobeOf([0, 0.316, -0.949], 0.01, [0, 0, 0, 0.01])
    return scene.reflectionDistant(P, N, lobe, [0, 0])
  }
  // The ray leaves a cube of half 4 at about 4.2 along it, before the wall at 11.6: the far trace, from the exit less
  // (1 − t) / 31 of its length (the 16 steps' jitter, t the exit's share of it), sees the wall.
  assert.ok(far(4).confidence > 0 && Math.abs(far(4).distance - 11.6) < 0.5)
  // One of half 14 holds the wall: the far trace starts past the ray's exit less the jitter, at about 11.9, and still sees
  // the wall it lies within the slope tolerance of (2 by default).
  assert.ok(far(14).confidence > 0 && Math.abs(far(14).distance - 11.7) < 0.5)
  // The far trace starts at the cube's exit, drawn in by a voxel of 252 across the cube, less (1 − t) / 31 of its length.
  const near = run(4)
  const lobe = near.reflectionLobeOf([0, 0.316, -0.949], 0.01, [0, 0, 0, 0.01])
  const [entry, exit] = near.reflectionRingSpan(0, P, lobe.R)
  assert.equal(entry, 0)
  const t = exit / 100
  assert.ok(Math.abs(near.reflectionDistantStart(P, lobe.R) - (t + (t - 1) / 31) * 100) < 1e-4)
  // With the switch off, or no field, none.
  views.reflectionView.scene = [50, 0, 0, 0]
  assert.equal(far(4).confidence, 0)
})

test('a hit takes the lit image only where it agrees with the depth and faces the eye; a ray brings back no more than its ceiling', () => {
  const wall: Box = { low: [-20, 0, -12], high: [20, 8, -11] }
  const view = camera([0, 2, 6], [0, 1, -10], 192, 108, (50 * Math.PI) / 180)
  const [field, views] = sceneFromDepth(view, rasterize(view, [wall]).depth)
  views.reflectionView.light = [40, 0.01, Math.cos((85 * Math.PI) / 180), 1000]
  const scene = reflectionRunner(field, views)
  const eye: Vec3 = [0, 2, 6],
    d = view.ray(96.5, 54.5)
  const front = castBoxes(eye, d, [wall]).t
  const at = (t: number) => [0, 1, 2].map((k) => eye[k] + d[k] * t) as Vec3
  const facing: Vec3 = [0, 0, 1]
  // The wall's own point agrees with the depth the image drew: the lit image's texel, the pixel it projects to, whole.
  const held = scene.reflectionHeld(at(front), facing)
  const pixel = view.project(at(front))
  assert.ok(Math.abs(held[0] - pixel[0]) < 1 && Math.abs(held[1] - pixel[1]) < 1, `${held}`)
  assert.ok(held[3] > 0.9, `${held[3]}`)
  // A point a metre behind the wall, or one whose face looks away from the eye, takes nothing.
  assert.equal(scene.reflectionHeld(at(front + 1), facing)[3], 0, 'off the depth')
  assert.equal(scene.reflectionHeld(at(front), [0, 0, -1])[3], 0, 'facing away')
  // The ceiling: the largest component 40, the colour scaled whole; a radiance under it unchanged.
  assert.deepEqual(scene.reflectionClampRay([100, 50, 10]), [40, 20, 4])
  assert.deepEqual(scene.reflectionClampRay([10, 5, 1]), [10, 5, 1])
})
