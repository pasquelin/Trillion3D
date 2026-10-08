// The batches that write their unit function's formula in the loop, against the loops over the
// unit functions they were (`batchBefore.fixture.ts`): on every matrix kind, swept elements with
// hostile values, single- and double-precision outputs and `out` as the input, every value keeps
// its bits and every count is the same.
import assert from 'node:assert/strict'
import test from 'node:test'
import { frustumKeepsBoxBatch, sphereFromBoundsBatch } from './culling.ts'
import { transformDirectionsBatch, transformPointsBatch } from './points.ts'
import {
  frustumKeepsBoxBatchBefore,
  sphereFromBoundsBatchBefore,
  transformDirectionsBatchBefore,
  transformPointsBatchBefore,
} from './batchBefore.fixture.ts'
import { frustumPlanesFromMatrix } from '../geometry/frustum/frustum.ts'
import { HALTON_SWEEP } from '../sequence/sweep.fixture.ts'
import { assertSameBits, MATRIX_KINDS, sweepInput, sweepMatrix } from '../sequence/moves.fixture.ts'

/** Case `i`'s `count` swept values on `[−20, 20)`, hostile values mixed in. */
const swept = (i: number, count: number) =>
  Float64Array.from({ length: count }, (_, k) => sweepInput(i, k, 2, -20, 20))

/** The cases: a few hundred, each up to eight elements. */
const CASES = HALTON_SWEEP / 8

test('transformPointsBatch, transformDirectionsBatch: the hoisted matrix keeps every bit', () => {
  const m = new Float64Array(16)
  for (let i = 1; i <= CASES; i++)
    for (let kind = 0; kind < MATRIX_KINDS; kind++) {
      sweepMatrix(m, i, kind)
      const n = i % 9,
        input = swept(i, 27),
        plain = Array.from(m)
      for (const make of [(k: number) => new Float64Array(k), (k: number) => new Float32Array(k)]) {
        const old = make(27).fill(7),
          now = make(27).fill(7)
        transformPointsBatchBefore(old, plain, input, n)
        transformPointsBatch(now, plain, input, n)
        assertSameBits(old, now, `points ${i} kind ${kind}`)
      }
      const oldIn = input.slice(),
        nowIn = input.slice()
      transformPointsBatchBefore(oldIn, m, oldIn, n)
      transformPointsBatch(nowIn, m, nowIn, n)
      assertSameBits(oldIn, nowIn, `points in place ${i} kind ${kind}`)
      const old = new Float64Array(27).fill(7),
        now = new Float64Array(27).fill(7)
      transformDirectionsBatchBefore(old, m, input, n)
      transformDirectionsBatch(now, m, input, n)
      assertSameBits(old, now, `directions ${i} kind ${kind}`)
      const oldDirs = input.slice(),
        nowDirs = input.slice()
      transformDirectionsBatchBefore(oldDirs, plain, oldDirs, n)
      transformDirectionsBatch(nowDirs, plain, nowDirs, n)
      assertSameBits(oldDirs, nowDirs, `directions in place ${i} kind ${kind}`)
    }
})

test('frustumKeepsBoxBatch, sphereFromBoundsBatch: the unit formula in the loop keeps every bit', () => {
  const m = new Float64Array(16),
    planes = new Float64Array(24)
  for (let i = 1; i <= CASES; i++)
    for (let kind = 0; kind < MATRIX_KINDS; kind++) {
      frustumPlanesFromMatrix(planes, sweepMatrix(m, i, kind))
      const n = i % 9,
        boxes = swept(i + kind * CASES, 48)
      const oldKept = new Uint8Array(9).fill(7),
        nowKept = new Uint8Array(9).fill(7)
      assert.equal(
        frustumKeepsBoxBatch(nowKept, planes, boxes, n),
        frustumKeepsBoxBatchBefore(oldKept, planes, boxes, n),
        `kept count ${i} kind ${kind}`,
      )
      assertSameBits(oldKept, nowKept, `kept ${i} kind ${kind}`)
      const old = new Float64Array(36).fill(7),
        now = new Float64Array(36).fill(7)
      sphereFromBoundsBatchBefore(old, boxes, n)
      sphereFromBoundsBatch(now, boxes, n)
      assertSameBits(old, now, `spheres ${i} kind ${kind}`)
      const oldIn = boxes.slice(),
        nowIn = boxes.slice()
      sphereFromBoundsBatchBefore(oldIn, oldIn, n)
      sphereFromBoundsBatch(nowIn, nowIn, n)
      assertSameBits(oldIn, nowIn, `spheres in place ${i} kind ${kind}`)
    }
})

test('frustumKeepsBoxBatch: a plane whose verdict rests on the order of its sum, in every slot', () => {
  // Left to right, `1 + 2^-53 + 2^-53 − (1 + 2^-52)` rounds to −2^-52 and the box is out; summed
  // in another order it is 0 and the box kept. The other five planes keep everything.
  const tie = [1, 1, 1, -(1 + 2 ** -52)],
    box = Float64Array.of(-1, -1, -1, 1, 2 ** -53, 2 ** -53)
  for (let slot = 0; slot < 6; slot++) {
    const planes = new Float64Array(24)
    for (let p = 0; p < 6; p++) planes.set(p === slot ? tie : [0, 0, 0, 1], 4 * p)
    const oldKept = new Uint8Array(1),
      nowKept = new Uint8Array(1)
    assert.equal(frustumKeepsBoxBatchBefore(oldKept, planes, box, 1), 0, `slot ${slot} excludes`)
    assert.equal(frustumKeepsBoxBatch(nowKept, planes, box, 1), 0, `slot ${slot}`)
    assertSameBits(oldKept, nowKept, `kept slot ${slot}`)
  }
})
