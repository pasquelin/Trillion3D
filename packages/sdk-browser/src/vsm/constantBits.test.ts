// The bit and index constants the shaders and the host share: the projection flags are single
// distinct bits of the five the record's word holds, the extended page marks sit above the four
// page mark bits and inside the twelve a page's flag word keeps for them, the counters are distinct
// indices of the stats row.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import * as constants from './constants.ts'

const { VSM_CONSTANTS_WGSL } = constants
const shader = wgslConstants(VSM_CONSTANTS_WGSL)

/** The numeric constants of the module whose name starts with `prefix`. */
const exported = (prefix: string) =>
  Object.entries(constants).filter(
    (entry): entry is [string, number] =>
      entry[0].startsWith(prefix) && typeof entry[1] === 'number',
  )

const isSingleBit = (value: number) => value > 0 && (value & (value - 1)) === 0

/** Throws unless `flags` are distinct single bits all below `limit`. */
function assertDistinctBits(flags: [string, number][], limit: number) {
  const seen = new Map<number, string>()
  for (const [name, value] of flags) {
    assert.ok(isSingleBit(value), `${name} = ${value} is not one bit`)
    assert.ok(value < limit, `${name} = ${value} is not below ${limit}`)
    assert.equal(seen.get(value), undefined, `${name} repeats ${seen.get(value)}`)
    seen.set(value, name)
  }
}

/** Throws unless `flags` are distinct single bits clear of `mask` and within the low `bits` bits. */
function assertExtendedBits(flags: [string, number][], mask: number, bits: number) {
  assertDistinctBits(flags, 1 << bits)
  for (const [name, value] of flags)
    assert.equal(value & mask, 0, `${name} overlaps the page mark bits`)
}

/** Throws unless `counters` are distinct indices below `count`. */
function assertDistinctBelow(counters: [string, number][], count: number) {
  const seen = new Set<number>()
  for (const [name, value] of counters) {
    assert.ok(
      Number.isInteger(value) && value >= 0 && value < count,
      `${name} = ${value} is not below ${count}`,
    )
    assert.ok(!seen.has(value), `${name} = ${value} repeats a counter`)
    seen.add(value)
  }
}

const projection = () => exported('VSM_MAP_')
const extended = () =>
  Object.entries(shader).filter(([name]) => name.startsWith('VSM_META_') && !name.includes('_ANY_'))
const stats = () => exported('VSM_COUNT_').filter(([name]) => name !== 'VSM_COUNTERS')

test('the projection flags are distinct bits below the sixth', () => {
  assert.equal(projection().length, 5)
  assertDistinctBits(projection(), 1 << 5)
})

test('the extended page marks clear the page mark bits and fit in twelve', () => {
  const mask = shader.VSM_PAGE_MARK_MASK
  assert.equal(mask, 0xf)
  assert.equal(extended().length, 8)
  assertExtendedBits(extended(), mask, 12)
})

test('the page counters are distinct indices of the stats row', () => {
  assert.equal(stats().length, 5)
  assertDistinctBelow(stats(), constants.VSM_COUNTERS)
})

test('the guards fail on a repeated bit, an overlap, a bit out of range or a repeated counter', () => {
  assert.throws(() => assertDistinctBits([...projection(), ['VSM_MAP_X', 1]], 1 << 5), /repeats/)
  assert.throws(
    () => assertDistinctBits([...projection(), ['VSM_MAP_X', 1 << 5]], 1 << 5),
    /not below/,
  )
  assert.throws(
    () => assertDistinctBits([...projection(), ['VSM_MAP_X', 3]], 1 << 5),
    /not one bit/,
  )
  assert.throws(
    () => assertExtendedBits([...extended(), ['VSM_META_X', 1 << 3]], 0xf, 12),
    /overlaps/,
  )
  assert.throws(
    () => assertExtendedBits([...extended(), ['VSM_META_X', 1 << 12]], 0xf, 12),
    /not below/,
  )
  assert.throws(
    () => assertDistinctBelow([...stats(), ['VSM_COUNT_X', 2]], constants.VSM_COUNTERS),
    /repeats/,
  )
  assert.throws(
    () => assertDistinctBelow([...stats(), ['VSM_COUNT_X', 5]], constants.VSM_COUNTERS),
    /not below/,
  )
})
