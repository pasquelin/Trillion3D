// The air's frame: where the eye stands on the planet. Held above the ground, left where it is
// above the air (the planet and its air are then seen from outside), not pulled under the top.
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateSceneAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import { coefficientsOf } from '../../../../sdk-core/src/scene/core/atmosphereOptics.ts'
import { AIR_RAY_WGSL } from './airRayWgsl.ts'
import { FRAME_FLOATS, writeAirFrame } from './frame.ts'
import { FRAME_LAYOUT } from './frameLayout.ts'

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const AIR = validateSceneAtmosphere(true)

/** The frame written for an eye `y` metres over the planet's ground at the origin: its place read
 *  back as the distance from the planet's centre, and the unit up there. */
function eyeAt(y: number, over: readonly [number, number] = [0, 0], air = AIR) {
  const out = new Float32Array(FRAME_FLOATS)
  writeAirFrame(
    out,
    { eye: [over[0], y, over[1]], world: IDENTITY, perspective: 1 },
    air,
    IDENTITY,
    IDENTITY,
    4,
    4,
  )
  const at = FRAME_LAYOUT.at
  return {
    height: out[at.camera + 3],
    place: [out[at.camera], out[at.camera + 1], out[at.camera + 2]],
    up: [out[at.up], out[at.up + 1], out[at.up + 2]],
  }
}

test('an eye inside the air stands where it is', () => {
  assert.ok(Math.abs(eyeAt(30_000).height - (AIR.planetRadius + 30)) < 1e-2)
})

test('an eye above the air is not pulled down under its top', () => {
  const top = coefficientsOf(AIR).topRadius
  for (const altitudeKm of [AIR.height + 10, 500]) {
    const { height, place, up } = eyeAt(altitudeKm * 1000)
    assert.ok(Math.abs(height - (AIR.planetRadius + altitudeKm)) < 0.1, `${altitudeKm} km`)
    assert.ok(height > top)
    // The place is the eye's height along the up, as the programs read it.
    place.forEach((c, i) => assert.ok(Math.abs(c - up[i] * height) < 0.1))
  }
})

test('an eye under the ground is lifted onto it, five metres over', () => {
  assert.ok(Math.abs(eyeAt(-800).height - (AIR.planetRadius + 0.005)) < 1e-3)
})

test('the planet’s top stands where `groundPosition` puts it: an eye above it is on its axis, one beside it is off', () => {
  const placed = validateSceneAtmosphere({ groundPosition: [30_000, -10_000] })
  const above = eyeAt(1000, [30_000, -10_000], placed)
  assert.ok(Math.abs(above.height - (AIR.planetRadius + 1)) < 1e-3)
  assert.ok(Math.abs(above.up[0]) < 1e-6 && Math.abs(above.up[2]) < 1e-6, 'straight over the top')
  // The same eye with the planet at the origin stands 31.6 km off its axis: up leans, the height
  // is that of the sphere there (curved away by d²/2R, 78 m).
  const beside = eyeAt(1000, [30_000, -10_000])
  assert.ok(beside.up[0] > 0.004 && beside.up[2] < -0.0015)
  assert.ok(
    Math.abs(beside.height - (AIR.planetRadius + 1 + 31.6 ** 2 / (2 * AIR.planetRadius))) < 0.01,
  )
})

/** The inverse view-projection of an orthographic view `height` metres tall looking along -z from
 *  the origin, turned by `tilt` radians about x: a column-major matrix from device coordinates. */
function orthographicInverse(height: number, tilt = 0) {
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)]
  const half = height / 2
  // x → (half, 0, 0), y → (0, half c, half s), z → (0, -s, c) times the far plane, 1 at the origin.
  return new Float32Array([
    half,
    0,
    0,
    0,
    0,
    half * c,
    half * s,
    0,
    0,
    -s * 1e4,
    c * 1e4,
    0,
    0,
    0,
    0,
    1,
  ])
}

test('the frame holds half an orthographic view’s height as the raise of its points, none for a perspective view', () => {
  const lift = (perspective: number, inverse: Float32Array) => {
    const out = new Float32Array(FRAME_FLOATS)
    writeAirFrame(
      out,
      { eye: [0, 10, 0], world: IDENTITY, perspective },
      AIR,
      IDENTITY,
      inverse,
      4,
      4,
    )
    return Array.from(out.slice(FRAME_LAYOUT.at.lift, FRAME_LAYOUT.at.lift + 4))
  }
  const near = (got: number[], want: number[]) =>
    got.forEach((c, i) => assert.ok(Math.abs(c - want[i]) < 1e-3, `${got} vs ${want}`))
  near(lift(0, orthographicInverse(2000)), [0, 1000, 0, 0])
  near(lift(0, orthographicInverse(2000, 0.7)), [0, 1000, 0, 0])
  near(lift(1, orthographicInverse(2000)), [0, 0, 0, 0])
})

test('the programs add the frame’s raise to an orthographic ray, and unproject nothing to find it', () => {
  const code = AIR_RAY_WGSL.text
  assert.ok(code.includes('scene+frame.lift.xyz-frame.eye.xyz'))
  assert.ok(!code.includes('airOrthoLift'))
  assert.equal(code.split('airUnproject(').length - 1, 3, 'the declaration and the two of the ray')
})
