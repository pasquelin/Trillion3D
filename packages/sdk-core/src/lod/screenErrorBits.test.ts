// The certified screen error to the bits, on the table its Rust mirror reads too
// (`screenErrorBits.json`; `projected_error_at`, `packages/page-codec-wasm/src/cut_error_tests.rs`):
// a drift on either side fails the side that moved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clusterErrorAtDepth } from './screenErrorBound.ts'

const { rows } = JSON.parse(
  readFileSync(new URL('./screenErrorBits.json', import.meta.url), 'utf8'),
) as { rows: string[] }

/** A table operand: decimal, as both languages parse it, or `inf`, `nan`. */
const operand = (word: string) => (word === 'inf' ? Infinity : word === 'nan' ? NaN : Number(word))

/** The bits of `value` as the table writes them: an f64 in hex, sixteen digits. */
function bitsOf(value: number) {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  return view.getBigUint64(0).toString(16).padStart(16, '0')
}

test('the screen error of every table row has the bits the table pins', () => {
  assert.ok(rows.length > 0)
  for (const row of rows) {
    const [operands, expected] = row.split(' : ')
    const [error, stretch, lateral, depth, radius, focal, near, perspective] = operands
      .split(' ')
      .map(operand)
    let got: string
    try {
      got = bitsOf(
        clusterErrorAtDepth(error, stretch, lateral, depth, radius, focal, near, perspective),
      )
    } catch {
      got = 'invalid'
    }
    assert.equal(got, expected, row)
  }
})
