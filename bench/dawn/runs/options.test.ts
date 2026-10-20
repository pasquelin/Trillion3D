import assert from 'node:assert/strict'
import { test } from 'node:test'
import { benchOptions } from './options.ts'

test('an A/B asks for its two checkouts and a whole number of rounds', () => {
  assert.throws(() => benchOptions(['an-open-world-of-every-cost', '--ab', 'A']), /usage/)
  assert.throws(
    () => benchOptions(['an-open-world-of-every-cost', '--ab', 'A', '--rounds', '4']),
    /usage/,
  )
  assert.throws(
    () => benchOptions(['an-open-world-of-every-cost', '--ab', 'A', 'B', '--rounds', 'abc']),
    /BENCH_AB/,
  )
  assert.throws(
    () => benchOptions(['an-open-world-of-every-cost', '--ab', 'A', 'B', '--rounds', '1']),
    /BENCH_AB/,
  )
  assert.throws(
    () => benchOptions(['an-open-world-of-every-cost', '--ab', 'A', 'B', '--least', 'abc']),
    /BENCH_AB/,
  )
  assert.throws(
    () => benchOptions(['an-open-world-of-every-cost', '--ab', 'A', 'B', '--dissect', 'x']),
    /usage/,
  )
  const options = benchOptions([
    'an-open-world-of-every-cost',
    '--dirty',
    '--ab',
    'A',
    'B',
    '--rounds',
    '4',
  ])
  assert.deepEqual(options.ab, ['A', 'B'])
  assert.equal(options.rounds, 4)
})

test('an A/B or a dissect is no business of the invoking checkout’s dirt, and an `--ab=A` is refused', () => {
  assert.throws(() => benchOptions(['an-open-world-of-every-cost', '--ab=A']), /usage/)
  assert.doesNotThrow(() => benchOptions(['an-open-world-of-every-cost', '--ab', 'A', 'B']))
})
