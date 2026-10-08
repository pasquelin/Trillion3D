// The card pass's matrices at the eye come from the engine's one composition
// (`matrixAtRenderOrigin`): against the sum it was written in before — the fourth column added in
// another order —, every entry stays within one unit in the last place of a single (the residue the
// eye cancels aside), and a card's points land within a thousandth of a pixel and one depth unit:
// no 8-bit pixel changes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { engineCamera } from '../../camera/camera.fixture.ts'
import { fieldCamera } from '../../gpu/dag/placementTree.fixture.ts'

/** The composition the card pass wrote before, rounded once to single. */
function before(matrix: ArrayLike<number>, eye: ArrayLike<number>) {
  const out = new Float32Array(16)
  for (let k = 0; k < 12; k++) out[k] = matrix[k]
  for (let r = 0; r < 4; r++)
    out[12 + r] =
      matrix[12 + r] + matrix[r] * eye[0] + matrix[4 + r] * eye[1] + matrix[8 + r] * eye[2]
  return out
}

const ulp = (x: number) => 2 ** (Math.floor(Math.log2(Math.abs(x) || 2 ** -126)) - 23)

/** Pixel x, y and depth of `p` (at the eye) under single matrix `m`, at 1280 × 720. */
function pixel(m: Float32Array, p: readonly number[]) {
  const clip = [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
  return [
    ((clip[0] / clip[3] + 1) / 2) * 1280,
    ((clip[1] / clip[3] + 1) / 2) * 720,
    clip[2] / clip[3],
  ]
}

test('the card matrices at the eye change no 8-bit pixel', () => {
  let seed = 9
  const next = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let i = 0; i < 200; i++) {
    const eye = [1e5 * (next() - 0.5), 30 * next(), 1e5 * (next() - 0.5)],
      at = [eye[0] + 500 * (next() - 0.5), 0, eye[2] - 300 - 500 * next()]
    const cam = engineCamera(fieldCamera(eye, at, 1e6))
    const old = before(cam.viewProjection, cam.eye),
      now = matrixAtRenderOrigin(new Float32Array(16), cam.viewProjection, cam.eye)
    for (let k = 0; k < 16; k++)
      // A fourth-column entry the eye cancels holds rounding residue alone, far under a unit.
      assert.ok(
        Math.abs(now[k] - old[k]) <= Math.max(ulp(old[k]), 1e-9),
        `entry ${k}: ${now[k]} against ${old[k]}`,
      )
    const p = [at[0] - eye[0] + 3, at[1] - eye[1] + 1, at[2] - eye[2]]
    const a = pixel(old, p),
      b = pixel(now, p)
    assert.ok(
      Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3,
      'within a thousandth of a pixel',
    )
    assert.ok(Math.abs(Math.fround(a[2]) - Math.fround(b[2])) <= ulp(a[2]), 'within a depth unit')
  }
})
