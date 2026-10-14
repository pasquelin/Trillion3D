import test from 'node:test'
import assert from 'node:assert/strict'
import { composeMatrix4Batch, composeMatrix4 } from './matrix4Compose.ts'
import { decomposeMatrix4 } from './matrix4Trs.ts'

test('composeMatrix4Batch and decomposeMatrix4: roundtrip', () => {
  const posIn = [new Float64Array([1, 2, 3])]
  const rotIn = [new Float64Array([0, 0, 0, 1])]
  const scaleIn = [new Float64Array([2, 3, 4])]
  const mats = [new Float64Array(16)]

  composeMatrix4Batch(mats, posIn, rotIn, scaleIn, 1)

  const posOut = [new Float64Array(3)]
  const rotOut = [new Float64Array(4)]
  const scaleOut = [new Float64Array(3)]
  decomposeMatrix4(mats[0], posOut[0], rotOut[0], scaleOut[0])

  assert.ok(Math.abs(posOut[0][0] - 1) < 1e-10)
  assert.ok(Math.abs(posOut[0][1] - 2) < 1e-10)
  assert.ok(Math.abs(posOut[0][2] - 3) < 1e-10)
  assert.ok(Math.abs(scaleOut[0][0] - 2) < 1e-10)
  assert.ok(Math.abs(scaleOut[0][1] - 3) < 1e-10)
  assert.ok(Math.abs(scaleOut[0][2] - 4) < 1e-10)
})

test('composeMatrix4Batch: the flat form writes the same sixteen floats as the sub-view form', () => {
  const positions = new Float64Array([1, 2, 3, -4, 5, -6])
  const quaternions = new Float64Array([0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5])
  const scales = new Float64Array([2, 3, 4, 1, 1, 0.5])
  const flat = new Float64Array(32)
  composeMatrix4Batch(flat, positions, quaternions, scales, 2)

  const views = [new Float64Array(16), new Float64Array(16)]
  composeMatrix4Batch(
    views,
    [positions.subarray(0, 3), positions.subarray(3, 6)],
    [quaternions.subarray(0, 4), quaternions.subarray(4, 8)],
    [scales.subarray(0, 3), scales.subarray(3, 6)],
    2,
  )
  assert.deepEqual(Array.from(flat.subarray(0, 16)), Array.from(views[0]))
  assert.deepEqual(Array.from(flat.subarray(16)), Array.from(views[1]))

  // And both are what the unit function writes, which is the oracle of the batch.
  const unit = composeMatrix4(new Float64Array(16), positions, quaternions, scales)
  assert.deepEqual(Array.from(unit), Array.from(views[0]))
})

test('composeMatrix4Batch: plain flat arrays remain numeric sinks, including an empty destination', () => {
  const positions = [1, 2, 3, -4, 5, -6]
  const quaternions = [0, 0, 0, 1, 0, 0, 0, 1]
  const scales = [2, 3, 4, 5, 6, 7]
  const expected = [
    2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1, 5, 0, 0, 0, 0, 6, 0, 0, 0, 0, 7, 0, -4, 5, -6,
    1,
  ]
  for (const out of [[], Array<number>(32), Array<number>(32).fill(0)]) {
    composeMatrix4Batch(out, positions, quaternions, scales, 2)
    assert.deepEqual(out, expected)
  }
})
