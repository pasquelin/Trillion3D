import test from 'node:test'
import { assertGolden } from '../golden.fixture.ts'
import { writeRotationQuaternion } from '../matrix/matrix4Trs.ts'
import { normalizeQuaternion } from './quaternion.ts'

test('normalizeQuaternion returns the bits of its Rust twin on every reference case', () => {
  assertGolden('quaternion_normalize', 'quaternion_normalize', (v) =>
    normalizeQuaternion(Float64Array.from(v)),
  )
})

test('writeRotationQuaternion returns the bits of its Rust twin on every reference case', () => {
  assertGolden('quaternion_normalize', 'rotation_quaternion', (v) => {
    const out = new Float64Array(4)
    writeRotationQuaternion(out, Float64Array.from(v))
    return out
  })
})
