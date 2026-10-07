import test from 'node:test'
import assert from 'node:assert/strict'
import { halton } from '../../../math/src/sequence/halton.ts'
import { hypot2, hypot3 } from '../../../math/src/float/hypot.ts'
import { length2 } from '../../../math/src/vector/vector.ts'
import { workgroupCount } from '../../../math/src/scalar/integers.ts'
import { TAU } from '../../../math/src/constants.ts'
import { isFloor, slide, freshReport } from './characterMove.ts'
import { capsulePass, type CapsuleContact, type CapsulePush } from './capsule.ts'
import { closestSegmentTriangle, triangleNormal } from './closest.ts'
import { tiltedTriangle } from './tiltedTriangle.fixture.ts'
import { createCharacterEye } from './characterEye.ts'
import { createDrive, driveTick } from './characterDrive.ts'
import { gripOf } from './grip.ts'
import { oldDriveApproach } from '../../../../bench/oracles/core/length-rule.ts'
import { HUMAN_BODY, RESPONSE_LEFT, RUN_CADENCE } from './characterSettings.ts'

/**
 * The length rule in collision (docs/MATHS.md "Lengths"): each site moved off `hypot` or a
 * division by a length, against its old expression as the oracle, over 4096 Halton points and
 * edges: feet, velocity and eye keep their `Math.fround` bits; parts, floor, wall, rest and
 * contacts are the same. A length within one ulp of a threshold (a multiple of half a radius, the
 * rest speed) may fall either side, one part more or a stop a tick apart: no sweep point does (0
 * of 100 000 part counts), and the edges sit on thresholds both roots hit exactly.
 */

const N = 4096,
  H = (i: number, base: number) => halton(i + 1, base)
const same = (a: number, b: number, what: string) =>
  assert.ok(Object.is(Math.fround(a), Math.fround(b)), `${what}: ${a} vs ${b}`)
/** A unit direction from two numbers of [0, 1). */
function unit(u: number, v: number) {
  const s = 2 * Math.sqrt(u * (1 - u))
  return [s * Math.cos(TAU * v), 1 - 2 * u, s * Math.sin(TAU * v)]
}
const R = HUMAN_BODY.capsuleRadius,
  fresh = () => freshReport({ ground: false, wall: false, impact: 0 })

/** Passes after a part (characterMove's `PASSES`), and a world whose every pass meets `met`. */
const PASSES = 4
let calls = 0,
  met: CapsuleContact
const world = {
  resolveCapsule: (_: unknown, push: CapsulePush) => (push(met), calls++, true),
  groundBelow: () => null,
}

test('slide: feet, velocity and impact keep their f32 bits; parts, floor and wall are the same', () => {
  // Edge normals: the axes, -0, nearly up, a 3-4-5 wall.
  const edges = [0, 1, 0, 1, 0, 0, 0, -1, 0, 0, 0, -1, -0, 1, 0, 1e-9, 1, 0, 0.6, 0, 0.8]
  for (let i = 0; i < N + edges.length / 3; i++) {
    const at = 3 * (i - N),
      n = Float64Array.from(i < N ? unit(H(i, 2), H(i, 3)) : edges.slice(at, at + 3))
    const c = (met = {
      normal: n,
      surface: Float64Array.from(unit(H(i, 5), H(i, 7))),
      point: Float64Array.of(0, H(i, 11) - 0.25, 0),
      depth: R * H(i, 13),
    })
    const rules = { maxSlope: Math.atan(1), onGround: i % 2 === 0, stepTop: 0.5 }
    // Every fifth delta is vertical, a whole number of half radii: on the threshold, both exact.
    const delta = (
      i % 5 ? unit(H(i, 7), H(i, 11)).map((d) => d * 4 * R * H(i, 17)) : [0, (i % 20) * 0.5 * R, 0]
    ) as [number, number, number]
    const start = [H(i, 3) * 100 - 50, H(i, 5) * 10, H(i, 2) * 100 - 50],
      speed = unit(H(i, 13), H(i, 5)).map((d) => d * 6)
    const capsule = { feet: Float64Array.from(start), radius: R, height: 1.75 },
      moving = { capsule, velocity: Float64Array.from(speed) }
    calls = 0
    const report = slide(world, moving, rules, delta, fresh())
    // The old slide and push.
    const [feet, velocity, old] = [Float64Array.from(start), Float64Array.from(speed), fresh()]
    const clip = (v: number[] | Float64Array, d: number[]) => {
      const into = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]
      if (into < 0) for (let k = 0; k < 3; k++) v[k] -= into * d[k]
    }
    const parts = workgroupCount(hypot3(delta[0], delta[1], delta[2]), 0.5 * R),
      part = delta.map((d) => d / parts)
    for (let p = 0; p < parts * PASSES; p++) {
      if (p % PASSES === 0) for (let k = 0; k < 3; k++) feet[k] += part[k]
      const across = hypot2(n[0], n[2])
      let [amount, away] = [c.depth, [...n]]
      if (isFloor(c, rules)) {
        const gap = R - c.depth
        away = [0, 1, 0]
        amount = Math.sqrt(R * R - (gap * across) ** 2) - gap * n[1]
        if (!old.ground) old.impact = -velocity[1]
        old.ground = true
      } else if (rules.onGround && n[1] >= 0 && across > 0) {
        if (n[1] > 0 && p % PASSES === 0) continue
        ;[away, amount, old.wall] = [[n[0] / across, 0, n[2] / across], c.depth / across, true]
      } else old.wall ||= n[1] >= 0
      for (let k = 0; k < 3; k++) feet[k] += amount * away[k]
      clip(velocity, away)
      clip(part, away)
    }
    assert.equal(calls, parts * PASSES, `parts at ${i}`)
    assert.deepEqual([report.ground, report.wall], [old.ground, old.wall], `flags at ${i}`)
    same(report.impact, old.impact, `impact at ${i}`)
    for (let k = 0; k < 3; k++) same(capsule.feet[k], feet[k], `feet ${k} at ${i}`)
    for (let k = 0; k < 3; k++) same(moving.velocity[k], velocity[k], `velocity ${k} at ${i}`)
  }
})

test('a segment piercing a triangle leaves along the same normal, by the same depth', () => {
  const [radius, height] = [0.3, 1.6]
  let pierced = 0
  for (let i = 0; i < N; i++) {
    const { tree, v, cx, cy, cz } = tiltedTriangle(i)
    const feet = Float64Array.of(cx + (H(i, 17) - 0.5) * 0.1, cy - 0.8 + (H(i, 19) - 0.5) * 0.4, cz)
    const seen: number[][] = []
    capsulePass(tree, { feet, radius, height }, (c) =>
      seen.push([...c.normal, ...c.surface, c.depth]),
    )
    const segment = [0, radius, 0, 0, height - radius, 0].map((d, k) => feet[k % 3] + d)
    if (closestSegmentTriangle(new Float64Array(6), segment, v, 0) !== 0) continue
    // The old `pierced`, then the old `faceOf`.
    const n = new Float64Array(3),
      length = Math.sqrt(triangleNormal(n, v, 0))
    for (let k = 0; k < 3; k++) n[k] /= length
    const side = (s: number) =>
      (segment[s] - v[0]) * n[0] + (segment[s + 1] - v[1]) * n[1] + (segment[s + 2] - v[2]) * n[2]
    const [low, high] = [Math.min(side(0), side(3)), Math.max(side(0), side(3))]
    const flip = !(radius - low <= radius + high),
      depth = flip ? radius + high : radius - low
    if (flip) for (let k = 0; k < 3; k++) n[k] = -n[k]
    assert.equal(seen.length, length > 0 && depth > 0 ? 1 : 0, `contact at ${i}`)
    if (!seen.length) continue
    pierced++
    const face = new Float64Array(3),
      area = Math.sqrt(triangleNormal(face, v, 0)),
      turn = face[0] * n[0] + face[1] * n[1] + face[2] * n[2] < 0 ? -1 : 1
    const expected = [...n, ...face.map((f) => f * (turn / area)), depth]
    expected.forEach((e, k) => same(seen[0][k], e, `contact ${k} at ${i}`))
  }
  assert.ok(pierced > N / 2, `${pierced} piercings`)
})

test("the eye's bob and a step's foot ahead keep their f32 bits", () => {
  const { walkSpeed, headBob } = HUMAN_BODY
  for (let i = 0; i <= N; i++) {
    const velocity =
      i < N ? unit(H(i, 2), H(i, 3)).map((d) => d * 10 ** (H(i, 5) * 8 - 7)) : [0, 0, -0]
    const [vx, , vz] = velocity,
      eye = createCharacterEye(HUMAN_BODY),
      delta = 1 / 30 / (1 + 7 * H(i, 7))
    const lifted = eye.offset(delta, velocity, true),
      pace = Math.min(1, hypot2(vx, vz) / walkSpeed),
      stride = (Math.PI * RUN_CADENCE * pace * delta) % TAU
    same(eye.stride, stride, `stride at ${i}`)
    same(lifted, -headBob * pace * Math.cos(2 * stride) + 0, `offset at ${i}`)
    // characterBody's step: a foot put a radius ahead of the move, none for no move.
    const [old, length] = [hypot2(vx, vz), length2(vx, vz)]
    assert.equal(length === 0, old === 0, `still at ${i}`)
    if (old === 0) continue
    const [reach, oldReach] = [Math.max(1, R / length), Math.max(1, R / old)]
    ;[vx, vz].forEach((d) => same(d * reach, d * oldReach, `step at ${i}`))
  }
})

test('the drive gathers, brakes and rests the same, to the f32 bit', () => {
  const REST = 1e-4,
    { walkSpeed, responseTime, stopTime, gravity } = HUMAN_BODY
  let rests = 0
  for (let i = 0; i < N; i++) {
    const [wishX, , wishZ] = i % 3 ? unit(H(i, 2), H(i, 3)).map((d) => d * H(i, 5)) : [0, 0, 0]
    const [vx, , vz] = unit(H(i, 7), H(i, 11)).map((d) => d * 10 ** (H(i, 13) * 6 - 5)),
      h = 1 / 120 + H(i, 17) / 60
    const drive = createDrive()
    drive.velocity.set([vx, 0, vz])
    const step = { dx: 0, dz: 0, jumped: false },
      moved = driveTick(drive, HUMAN_BODY, { wishX, wishZ, sprint: false }, h, false, {}, step)
    // The old approach and rest test.
    const [tx, tz] = [wishX * walkSpeed, wishZ * walkSpeed],
      wishing = tx !== 0 || tz !== 0
    const rate = -Math.log(RESPONSE_LEFT) / (wishing ? responseTime : stopTime),
      push = gripOf(drive.floor) * gravity
    const expected = oldDriveApproach(vx, vz, tx, tz, h, rate, push)
    if (!wishing && hypot2(expected[2], expected[3]) < REST * rate) {
      expected[2] = expected[3] = 0
      rests++
    }
    assert.equal(moved, true, `moved at ${i}`)
    const got = [step.dx, step.dz, drive.velocity[0], drive.velocity[2]]
    expected.forEach((e, k) => same(got[k], e, `${k}`))
  }
  assert.ok(rests > 100, `${rests} stops`)
})
