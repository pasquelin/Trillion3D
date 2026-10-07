import assert from 'node:assert/strict'
import test from 'node:test'
import { eulerFromRotationMatrix } from './euler.ts'

/** 3×3 rotations written out by hand, as rows. */
const rx = (a: number) => [
  [1, 0, 0],
  [0, Math.cos(a), -Math.sin(a)],
  [0, Math.sin(a), Math.cos(a)],
]
const ry = (a: number) => [
  [Math.cos(a), 0, Math.sin(a)],
  [0, 1, 0],
  [-Math.sin(a), 0, Math.cos(a)],
]
const rz = (a: number) => [
  [Math.cos(a), -Math.sin(a), 0],
  [Math.sin(a), Math.cos(a), 0],
  [0, 0, 1],
]
const times = (a: number[][], b: number[][]) =>
  a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]))

/** The column-major 4×4 of a 3×3 given by rows, with a translation the angles must ignore. */
const columnMajor = (r: number[][]) =>
  Float64Array.from([...[0, 1, 2].flatMap((c) => [r[0][c], r[1][c], r[2][c], 0]), 4, 5, 6, 1])

const near = (got: ArrayLike<number>, want: number[]) => {
  for (let i = 0; i < 3; i++)
    assert.ok(Math.abs(got[i] - want[i]) <= 1e-12, `${i}: ${got[i]} vs ${want[i]}`)
}

test('XYZ: the angles of Rx · Ry · Rz come back, the first letter outermost', () => {
  const [x, y, z] = [0.4, -0.7, 1.1]
  const m = columnMajor(times(times(rx(x), ry(y)), rz(z)))
  near(eulerFromRotationMatrix(new Float64Array(3), m), [x, y, z])
  near(eulerFromRotationMatrix(new Float64Array(3), m, 'XYZ'), [x, y, z])
})

test('ZYX: the angles of Rz · Ry · Rx come back', () => {
  const [x, y, z] = [-1.2, 0.5, 2.3]
  const m = columnMajor(times(times(rz(z), ry(y)), rx(x)))
  near(eulerFromRotationMatrix(new Float64Array(3), m, 'ZYX'), [x, y, z])
})

test('the other four orders give their angles back too', () => {
  const [x, y, z] = [0.3, 0.9, -0.6]
  const r = { X: rx(x), Y: ry(y), Z: rz(z) }
  for (const order of ['YXZ', 'ZXY', 'YZX', 'XZY'] as const) {
    const [a, b, c] = [...order] as ('X' | 'Y' | 'Z')[]
    const m = columnMajor(times(times(r[a], r[b]), r[c]))
    near(eulerFromRotationMatrix(new Float64Array(3), m, order), [x, y, z])
  }
})

test('Ry(π/2) takes the pole branch: the middle angle at π/2, the outer two locked at 0', () => {
  const m = columnMajor(ry(Math.PI / 2))
  // The sine of the pitch rounds to 1, past the pole.
  assert.equal(m[8], 1)
  const out = eulerFromRotationMatrix([9, 9, 9], m)
  near(out, [0, Math.PI / 2, 0])
  assert.equal(out[2], 0)
})
