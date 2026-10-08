import assert from 'node:assert/strict'
import { test } from 'node:test'
import { benchOptions } from './options.ts'

test('an A/B asks for its two checkouts and a whole number of rounds', () => {
  assert.throws(() => benchOptions(['an-open-world-of-every-cost', '--ab', 'A']), /usage/)
  assert.throws(
    () => benchOptions(['an-open-world-of-every-cost', '--ab', 'A', '--rounds', '4']),
    /usage/,
  )
  assert.throws(() => benchOptions(['an-open-world-of-every-cost', '--rounds', 'abc']), /BENCH_AB/)
  assert.throws(() => benchOptions(['an-open-world-of-every-cost', '--rounds', '1']), /BENCH_AB/)
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
