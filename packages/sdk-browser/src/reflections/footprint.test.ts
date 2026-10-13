// The reflection over whole views, shipped WGSL run as JavaScript (`scene.fixture.ts`): a thin
// sheet over a plank at grazing angles, where no hit lies where the exact ray cast meets nothing or
// meets something farther, and the elliptical footprint a hit reads — one tap on a round lobe, taps
// along the long axis of a stretched one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { REFLECTION_CONE_WGSL } from './footprint.ts'
import { REFLECTION_CONSTANTS } from './constants.ts'
import { reflectionRunner, sceneOver, viewOf } from './scene.fixture.ts'
import { depthField } from './depthField.fixture.ts'
import { camera, castBoxes, type Box, type V3 } from './boxes.fixture.ts'

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
    const eye: V3 = [9 * Math.sin(a), height, 9 * Math.cos(a)]
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
        const P = [0, 1, 2].map((k) => eye[k] + d[k] * front.t) as V3
        if (Math.abs(P[2] - sheet.high[2]) > 1e-9) continue
        const R: V3 = [d[0], d[1], -d[2]]
        const seen = scene.reflectionSeen(
          P,
          [0, 0, 1],
          scene.reflectionLobeOf(R, 0.01, [0, 0, 0, 0.01]),
        )
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
          T = view.project([0, 1, 2].map((k) => P[k] + R[k] * exact) as V3)
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
  const { reflectionConeTangent } = shaderRun<{ reflectionConeTangent: (a: number) => number }>(
    wgslModule(REFLECTION_CONE_WGSL),
    ['reflectionConeTangent'],
    {},
  )
  const hit: V3 = [0, 1, 0],
    R: V3 = [0, 0, 1],
    Q = view.project(hit).slice(0, 2),
    pixel = view.project(hit)[3] * view.scale
  /** The footprint's taps from `P`, two metres or more from the hit, of `alpha` and `lobe`. */
  const taps = (P: V3, alpha: number, lobe: number[]) => {
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
    (2 * distance * reflectionConeTangent(alpha)) / pixel
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
