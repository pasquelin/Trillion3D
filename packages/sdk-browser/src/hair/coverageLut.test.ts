import test from 'node:test'
import assert from 'node:assert/strict'
import { HAIR_COVERAGE_LUT_SIZE, hairCoverageTable } from './coverageLut.ts'

const N = HAIR_COVERAGE_LUT_SIZE
const at = (table: Float32Array, count: number, column: number) => table[count * N + column]!

test('the coverage table covers nothing for no strand and one strand covers its width', () => {
  const table = hairCoverageTable()
  assert.equal(table.length, N * N)
  for (let column = 0; column < N; column++) {
    assert.equal(at(table, 0, column), 0)
    assert.ok(Math.abs(at(table, 1, column) - (column + 0.5) / N) < 1e-6)
  }
})

test('the coverage table grows with the count and with the width, and stays within 0 and 1', () => {
  const table = hairCoverageTable()
  for (let count = 0; count < N; count++)
    for (let column = 0; column < N; column++) {
      const value = at(table, count, column)
      assert.ok(value >= 0 && value <= 1)
      if (count > 0) assert.ok(value >= at(table, count - 1, column))
      if (column > 0) assert.ok(value >= at(table, count, column - 1))
    }
})

test('two strands of nearly half the line cover about three quarters of it', () => {
  const table = hairCoverageTable()
  // Column 31 stands for the width 31.5 / 64, just under a half.
  const width = (31 + 0.5) / N
  assert.ok(Math.abs(at(table, 2, 31) - (1 - (1 - width) ** 2)) < 1e-6)
  assert.ok(Math.abs(at(table, 2, 31) - 0.74) < 0.02)
})

test('the coverage mapping is an option of the strands, off by default, and its shader agrees with the table size', async () => {
  const { HAIR_STRANDS_RULES } =
    await import('../../../sdk-core/src/contracts/hairStrandsOptions.ts')
  assert.equal(HAIR_STRANDS_RULES.hairVisibilityCoverageMapping.default, false)
  const { HAIR_COVERAGE_MAP_WGSL } = await import('./coverageMapWgsl.ts')
  assert.ok(HAIR_COVERAGE_MAP_WGSL.includes(`TABLE_LAST=${N - 1}u`))
})
