// The frustum's rewrites against their before-forms (`frustumBefore.fixture.ts`). The point, sphere,
// box and clip-box tests: on the planes of every matrix kind and on swept planes with hostile values, for
// swept points, radii and boxes, every verdict is the loop's. The plane builders: on every matrix
// kind and on a swept one, into `Float64Array` and `Float32Array`, with `out` sharing the memory
// of `m` or of `view`, every value keeps its bits and nothing past the planes is written.
import assert from 'node:assert/strict'
import test from 'node:test'
import { frustumClipBox, frustumExcludesBox } from './box.ts'
import {
  clipPlanesFromMatrix,
  frustumContainsPoint,
  frustumExcludesSphere,
  frustumFarPlane,
  frustumPlanesFromMatrix,
} from './frustum.ts'
import {
  clipPlanesFromMatrixBefore,
  frustumClipBoxBefore,
  frustumContainsPointBefore,
  frustumExcludesBoxBefore,
  frustumExcludesSphereBefore,
  frustumFarPlaneBefore,
  frustumPlanesFromMatrixBefore,
} from './frustumBefore.fixture.ts'
import { HALTON_SWEEP } from '../../sequence/sweep.fixture.ts'
import {
  assertSameBits,
  MATRIX_KINDS,
  sweepInput,
  sweepMatrix,
} from '../../sequence/moves.fixture.ts'

test('frustumContainsPoint, frustumExcludesSphere, frustumExcludesBox: the same verdicts as the loops', () => {
  const m = new Float64Array(16),
    planes = new Float64Array(24),
    edge = new Float64Array(24)
  let kept = 0,
    excluded = 0,
    boxesIn = 0,
    boxesOut = 0
  for (let i = 1; i <= HALTON_SWEEP; i++)
    for (let kind = 0; kind <= MATRIX_KINDS; kind++) {
      if (kind < MATRIX_KINDS) frustumPlanesFromMatrix(planes, sweepMatrix(m, i, kind))
      else for (let k = 0; k < 24; k++) planes[k] = sweepInput(i, k, 3, -2, 2)
      const x = sweepInput(i, 30, 2, -3, 3),
        y = sweepInput(i, 31, 5, -3, 3),
        z = sweepInput(i, 32, 7, -3, 3),
        reach = sweepInput(i, 33, 3, -1, 2)
      const inside = frustumContainsPointBefore(planes, x, y, z),
        behind = frustumExcludesSphereBefore(planes, x, y, z, reach)
      const box = [34, 35, 36, 37, 38, 39].map((slot) => sweepInput(i, slot, 2, -3, 3)) as Box,
        outside = frustumExcludesBoxBefore(planes, ...box)
      assert.equal(frustumExcludesBox(planes, ...box), outside, `box ${i} kind ${kind}`)
      assert.equal(
        frustumClipBox(planes, ...box),
        frustumClipBoxBefore(planes, ...box),
        `clip ${i}`,
      )
      // The planes moved through the box's most forward corner, `d` its sum in another order: the
      // verdict then rests on the sum's last rounding.
      for (let p = 0; p < 24; p += 4) {
        const [a, b, c] = [planes[p], planes[p + 1], planes[p + 2]]
        edge[p] = a
        edge[p + 1] = b
        edge[p + 2] = c
        edge[p + 3] = -(
          c * (c > 0 ? box[5] : box[2]) +
          (b * (b > 0 ? box[4] : box[1]) + a * (a > 0 ? box[3] : box[0]))
        )
      }
      assert.equal(
        frustumExcludesBox(edge, ...box),
        frustumExcludesBoxBefore(edge, ...box),
        `box ${i} kind ${kind} on the edge`,
      )
      assert.equal(
        frustumClipBox(edge, ...box),
        frustumClipBoxBefore(edge, ...box),
        `clip ${i} edge`,
      )
      if (outside) boxesOut++
      else boxesIn++
      assert.equal(frustumContainsPoint(planes, x, y, z), inside, `point ${i} kind ${kind}`)
      assert.equal(
        frustumExcludesSphere(planes, x, y, z, reach),
        behind,
        `sphere ${i} kind ${kind}`,
      )
      if (inside) kept++
      if (behind) excluded++
    }
  assert.ok(kept > 0 && excluded > 0, `${kept} points kept, ${excluded} spheres excluded`)
  assert.ok(boxesIn > 0 && boxesOut > 0, `${boxesIn} boxes kept, ${boxesOut} excluded`)
})

type Box = [number, number, number, number, number, number]
type Planes = Float32Array | Float64Array
type Build = (out: Planes, m: ArrayLike<number>) => void

/** Runs `old` and `now` on sentinel buffers of `Out` holding the planes and the matrix `m`, `m`
 *  starting `shift` floats after the planes (past them at 24) or, below 0, `−shift` floats before
 *  them, and asserts every value of both buffers the same. */
function sameBuffers(
  Out: typeof Float64Array | typeof Float32Array,
  m: ArrayLike<number>,
  shift: number,
  old: Build,
  now: Build,
  label: string,
) {
  const outAt = Math.max(0, -shift),
    mAt = Math.max(0, shift),
    oldBuffer = new Out(50).fill(7),
    nowBuffer = new Out(50).fill(7)
  oldBuffer.set(m, mAt)
  nowBuffer.set(m, mAt)
  old(oldBuffer.subarray(outAt, outAt + 24), oldBuffer.subarray(mAt, mAt + 16))
  now(nowBuffer.subarray(outAt, outAt + 24), nowBuffer.subarray(mAt, mAt + 16))
  assertSameBits(oldBuffer, nowBuffer, label)
}

test('frustumPlanesFromMatrix, clipPlanesFromMatrix, frustumFarPlane: the unrolled planes keep every bit', () => {
  const m = new Float64Array(16)
  for (let i = 1; i <= HALTON_SWEEP; i++)
    for (let kind = 0; kind <= MATRIX_KINDS; kind++) {
      if (kind < MATRIX_KINDS) sweepMatrix(m, i, kind)
      else for (let k = 0; k < 16; k++) m[k] = sweepInput(i, k + 40, 2, -1e3, 1e3)
      const far = sweepInput(i, 60, 3, -50, 1e4),
        at = 4 * (i % 6),
        normalize = (i & 1) === 1,
        label = `${i} kind ${kind}`
      for (const shift of [24, (i * 2) % 24, -(i % 24)])
        for (const Out of [Float64Array, Float32Array]) {
          const kindLabel = `${label} ${Out.name} shift ${shift}`
          sameBuffers(
            Out,
            m,
            shift,
            frustumPlanesFromMatrixBefore,
            frustumPlanesFromMatrix,
            kindLabel,
          )
          sameBuffers(
            Out,
            m,
            shift,
            (out, view) => frustumFarPlaneBefore(out, at, view, far, normalize),
            (out, view) => frustumFarPlane(out, at, view, far, normalize),
            `far ${kindLabel}`,
          )
        }
      const old = new Float64Array(26).fill(7),
        now = new Float64Array(26).fill(7)
      clipPlanesFromMatrixBefore(old, m)
      clipPlanesFromMatrix(now, m)
      assertSameBits(old, now, `clip ${label}`)
      sameBuffers(
        Float64Array,
        m,
        (i & 1 ? 1 : -1) * ((i >> 1) % 24),
        (out, view) => clipPlanesFromMatrixBefore(out as Float64Array, view),
        (out, view) => clipPlanesFromMatrix(out as Float64Array, view),
        `clip ${label} shared`,
      )
    }
})
