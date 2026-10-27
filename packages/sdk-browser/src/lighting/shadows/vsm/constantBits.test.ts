// The bit and index constants the shaders and the host share: the projection flags are single
// distinct bits of the 32-bit word the record keeps them in (`flags`, `projectionData.ts`), the extended page marks sit above the four
// page mark bits and inside the sixteen a page's flag word keeps for them (the reference's extended flags run to bit 15), the counters are distinct
// indices of the stats row.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import * as constants from './constants.ts'
import * as prefiltered from './prefilteredConstants.ts'

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

test('the projection flags are distinct bits of the record’s 32-bit word', () => {
  // Seven: the cache state's four (uncached, unseen, coarse, coverage), the coarse pages keeping their
  // dynamic layer, the first-person clipmap and the distant light (`VSM_MAP_DISTANT`, bit 7).
  assert.equal(projection().length, 7)
  assertDistinctBits(projection(), 2 ** 31)
})

test('the extended page marks clear the page mark bits and fit in sixteen', () => {
  const mask = shader.VSM_PAGE_MARK_MASK
  assert.equal(mask, 0xf)
  assert.equal(extended().length, 10)
  assertExtendedBits(extended(), mask, 16)
})

test('the page counters are distinct indices of the stats row', () => {
  assert.equal(stats().length, 7)
  assertDistinctBelow(stats(), constants.VSM_COUNTERS)
})

test('the guards fail on a repeated bit, an overlap, a bit out of range or a repeated counter', () => {
  assert.throws(() => assertDistinctBits([...projection(), ['VSM_MAP_X', 1]], 2 ** 31), /repeats/)
  assert.throws(
    () => assertDistinctBits([...projection(), ['VSM_MAP_X', 2 ** 31]], 2 ** 31),
    /not below/,
  )
  assert.throws(
    () => assertDistinctBits([...projection(), ['VSM_MAP_X', 3]], 2 ** 31),
    /not one bit/,
  )
  assert.throws(
    () => assertExtendedBits([...extended(), ['VSM_META_X', 1 << 3]], 0xf, 16),
    /overlaps/,
  )
  assert.throws(
    () => assertExtendedBits([...extended(), ['VSM_META_X', 1 << 16]], 0xf, 16),
    /not below/,
  )
  assert.throws(
    () => assertDistinctBelow([...stats(), ['VSM_COUNT_X', 2]], constants.VSM_COUNTERS),
    /repeats/,
  )
  assert.throws(
    () => assertDistinctBelow([...stats(), ['VSM_COUNT_X', 7]], constants.VSM_COUNTERS),
    /not below/,
  )
})

test('the prefiltered distant shadow’s record flag and level index sit clear of the other flags', () => {
  const flag = ['VSM_MAP_PREFILTERED_DISTANT', prefiltered.VSM_MAP_PREFILTERED_DISTANT] as [
    string,
    number,
  ]
  // The flag is one more bit among the record's, below the level index's byte.
  assertDistinctBits([...projection(), flag], 1 << prefiltered.VSM_MAP_LEVEL_INDEX_SHIFT)
  assert.equal(projection().length, 7, 'the plain flags are the seven they are')
  const index = prefiltered.VSM_MAP_LEVEL_INDEX_MASK << prefiltered.VSM_MAP_LEVEL_INDEX_SHIFT
  for (const [name, value] of [...projection(), flag])
    assert.equal(value & index, 0, `${name} overlaps the level index`)
  assert.ok(index < 2 ** 31, 'the level index stays below the sign bit')
})

test('the request bits sit above the page marks and the pool page info’s own bits, apart from each other', () => {
  const requests: [string, number][] = [
    ['VSM_PAGE_PRIMARY', prefiltered.VSM_PAGE_PRIMARY],
    ['VSM_PAGE_SECONDARY', prefiltered.VSM_PAGE_SECONDARY],
  ]
  assertDistinctBits(requests, 2 ** 31)
  for (const [name, value] of requests) {
    assert.equal(value & shader.VSM_PAGE_MARK_MASK, 0, `${name} overlaps the page marks`)
    for (const [meta, bit] of extended()) assert.equal(value & bit, 0, `${name} overlaps ${meta}`)
    assert.ok(value >= 1 << 16, `${name} is not above the sixteen bits of the marks and the meta`)
  }
  assert.equal(
    prefiltered.VSM_PAGE_AUX_MASK,
    shader.VSM_PAGE_FINE | prefiltered.VSM_PAGE_PRIMARY | prefiltered.VSM_PAGE_SECONDARY,
  )
})

test('the page table entry’s secondary bit is one the address, the coarser levels and the flags leave free', () => {
  const bit = prefiltered.VSM_ENTRY_SECONDARY_BIT
  assert.ok(isSingleBit(bit))
  const coarser = shader.VSM_ENTRY_COARSER_MASK << shader.VSM_ENTRY_COARSER_SHIFT
  const used = (0x3ff | (0x3ff << 10) | coarser | shader.VSM_ENTRY_DRAWABLE_BIT) >>> 0
  assert.equal((used | shader.VSM_ENTRY_MAPPED_BIT) & bit, 0)
  assert.equal(bit, 1 << 29, 'bit 29')
})
