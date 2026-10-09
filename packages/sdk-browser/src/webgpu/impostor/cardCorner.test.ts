// The card pass turns each card to the camera itself, at the eye: its corners, run from the shipped
// text, are the CPU's shared sprite basis at the card's pivot (`impostorCardCorners`), the eye
// taken off; a card wholly past one side of the frustum is told, one that touches it never.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../impostor/lent.fixture.ts'
import { Mat, shaderRun, type Vec } from '../../texture/shaderRun.fixture.ts'
import { cardPassWgsl } from './cardWgsl.ts'
import { impostorCardCorners } from '../../impostor/card.fixture.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { fieldCamera } from '../../gpu/dag/placementTree.fixture.ts'

const run = shaderRun<{
  cardCorner(basis: Mat, centre: Vec, radius: number, k: number): number[]
  cardOutside(c0: Vec, c1: Vec, c2: Vec, c3: Vec): boolean
}>(cardPassWgsl(), ['spriteAt', 'cardCorner', 'cardOutside'], {
  mat4x4f: (...columns: number[][]) => new Mat(columns.flat()),
})

/** `matrix · translation(eye)`: the matrix at the eye. */
function atEye(matrix: ArrayLike<number>, eye: ArrayLike<number>) {
  const out = Array.from(matrix)
  for (let r = 0; r < 4; r++)
    out[12 + r] += matrix[r] * eye[0] + matrix[4 + r] * eye[1] + matrix[8 + r] * eye[2]
  return out
}

test('the corners the pass turns at the eye are the shared sprite basis at the pivot', () => {
  for (const [eye, at] of [
    [
      [3, 1.7, -2],
      [40, 0, -900],
    ],
    [
      [1e5, 30, -2e4],
      [1e5 + 300, 0, -2.1e4],
    ],
  ]) {
    const cam = engineCamera(fieldCamera(eye, at, 1e6)),
      pivot = [at[0] + 2, at[1] + 1, at[2] - 3],
      radius = 4.5
    const cpu = impostorCardCorners(new Float64Array(12), cam.viewProjection, pivot, radius)
    const basis = new Mat(atEye(cam.viewProjection, cam.eye)),
      centre = pivot.map((x, k) => x - cam.eye[k])
    for (let k = 0; k < 4; k++) {
      const corner = run.cardCorner(basis, centre, radius, k)
      for (let i = 0; i < 3; i++) {
        const expected = cpu[k * 3 + i] - cam.eye[i]
        assert.ok(Math.abs(corner[i] - expected) <= 1e-9 * (1 + Math.abs(cpu[k * 3 + i])), `${k}`)
      }
    }
  }
})

test('a card is told outside only when every corner lies past one side of the frustum', () => {
  const p = (x: number, y: number, z: number, w = 1) => [x, y, z, w]
  const inside = [p(-0.5, -0.5, 0.5), p(0.5, -0.5, 0.5), p(0.5, 0.5, 0.5), p(-0.5, 0.5, 0.5)]
  assert.equal(run.cardOutside(...(inside as [Vec, Vec, Vec, Vec])), false)
  // Straddling the right side: one corner in, the card drawn.
  const straddle = [p(0.5, 0, 0.5), p(1.5, 0, 0.5), p(1.5, 0.2, 0.5), p(0.9, 0.2, 0.5)]
  assert.equal(run.cardOutside(...(straddle as [Vec, Vec, Vec, Vec])), false)
  for (const [axis, sign] of [
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
  ]) {
    const past = inside.map((c) => c.map((v, i) => (i === axis ? v + 2 * sign : v)))
    assert.equal(run.cardOutside(...(past as [Vec, Vec, Vec, Vec])), true, `${axis} ${sign}`)
  }
  // Nearer than the near plane (z above w), or past the far one (z below 0).
  const near = inside.map((c) => [c[0], c[1], 1.5, 1])
  const far = inside.map((c) => [c[0], c[1], -0.5, 1])
  assert.equal(run.cardOutside(...(near as [Vec, Vec, Vec, Vec])), true)
  assert.equal(run.cardOutside(...(far as [Vec, Vec, Vec, Vec])), true)
})
