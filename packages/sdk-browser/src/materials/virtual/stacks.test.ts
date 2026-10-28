// The maps of one material read at the same coordinates — texture set, transform, addressing — are a stack: each
// is a sibling of the others, in either atlas; a map read elsewhere, or the same texture twice, adds none.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import {
  mergeSiblings,
  SIBLING_BIAS_ORIGIN,
  SIBLING_DATA,
  SIBLING_SLOT_MASK,
  siblingRef,
  siblingWord,
} from './page/pageTable.ts'
import { noteStacks, sizeBias, type SiblingSets, type StackedMap } from './stacks.ts'

const map = (
  channel = 0,
  transform = [1, 0, 0, 0, 1, 0, 0, 0, 1],
  wrap = 'repeat',
  filter = 'linearMipLinear',
  anisotropy = 1,
) =>
  ({
    channel,
    wrapS: wrap,
    wrapT: wrap,
    magFilter: 'linear',
    minFilter: filter,
    anisotropy,
    transform,
  }) as unknown as Texture

const siblingsOf = (sets: SiblingSets, kind: 'color' | 'data', slot: number) => [
  ...(sets[kind][slot] ?? []),
]

const noted = (maps: StackedMap[]) => {
  const sets: SiblingSets = { color: [], data: [] }
  noteStacks(sets, maps)
  return sets
}

test('the maps read at the same coordinates are each other’s siblings, in the atlas they lie in', () => {
  const sets = noted([
    { texture: map(), kind: 'color', slot: 1 },
    { texture: map(), kind: 'data', slot: 4 },
    { texture: map(), kind: 'data', slot: 5 },
  ])
  assert.deepEqual(siblingsOf(sets, 'color', 1), [
    (4 | SIBLING_DATA) >>> 0,
    (5 | SIBLING_DATA) >>> 0,
  ])
  assert.deepEqual(siblingsOf(sets, 'data', 4), [1, (5 | SIBLING_DATA) >>> 0])
})

test('a map of another texture set, transform or addressing is in another stack', () => {
  const sets = noted([
    { texture: map(), kind: 'color', slot: 1 },
    { texture: map(1), kind: 'data', slot: 2 },
    { texture: map(0, [2, 0, 0, 0, 2, 0, 0, 0, 1]), kind: 'data', slot: 3 },
    { texture: map(0, undefined, 'clamp'), kind: 'data', slot: 4 },
  ])
  assert.deepEqual(siblingsOf(sets, 'color', 1), [])
})

test('a texture read twice by a material is no sibling of itself; the siblings of two materials add up', () => {
  const shared = { texture: map(), kind: 'color' as const, slot: 1 }
  const sets: SiblingSets = { color: [], data: [] }
  noteStacks(sets, [shared, { ...shared }, { texture: map(), kind: 'data', slot: 2 }])
  assert.deepEqual(siblingsOf(sets, 'color', 1), [(2 | SIBLING_DATA) >>> 0])
  for (let slot = 10; slot < 20; slot++)
    noteStacks(sets, [shared, { texture: map(), kind: 'data', slot }])
  assert.equal(
    siblingsOf(sets, 'color', 1).length,
    11,
    'all of them: the table caps the ones of its size',
  )
})

test('the filter and the anisotropy of a map are not in the key of its stack: each layer keeps its sampler', () => {
  const sets = noted([
    { texture: map(), kind: 'color', slot: 1 },
    { texture: map(0, undefined, 'repeat', 'nearest', 8), kind: 'data', slot: 2 },
  ])
  assert.deepEqual(siblingsOf(sets, 'color', 1), [(2 | SIBLING_DATA) >>> 0])
})

test('the bias of two sizes is the log2 of their ratio, the smaller side’s, negative for a larger sibling', () => {
  assert.equal(sizeBias(2048, 2048, 2048, 2048), 0)
  assert.equal(sizeBias(4096, 4096, 1024, 1024), 2)
  assert.equal(sizeBias(1024, 1024, 4096, 4096), -2)
  assert.equal(
    sizeBias(4096, 2048, 1024, 1024),
    1,
    'a map of another aspect is cropped: the smaller bias',
  )
  assert.equal(sizeBias(3000, 3000, 1024, 1024), 2, 'rounded up, as the reference takes it')
})

test('a sibling’s word holds its slot, its atlas and the bias, and is never zero', () => {
  const word = siblingWord(siblingRef('data', 5), -3)
  assert.equal(word & SIBLING_SLOT_MASK, 5)
  assert.equal(word & SIBLING_DATA, (SIBLING_DATA >>> 0) | 0)
  assert.equal((word >>> 24) & 0x1f, SIBLING_BIAS_ORIGIN - 3)
  assert.notEqual(siblingWord(siblingRef('color', 0), 0), 0)
})

test('a list joined by words replaces the one it already holds and is cut at the cap', () => {
  const a = siblingWord(siblingRef('color', 2), 0),
    b = siblingWord(siblingRef('data', 3), 1),
    b2 = siblingWord(siblingRef('data', 3), -1)
  assert.deepEqual(mergeSiblings([a, b], [b2]), [a, b2])
  const many = Array.from({ length: 12 }, (_, i) => siblingWord(siblingRef('color', i + 1), 0))
  assert.equal(mergeSiblings([], many).length, 8)
})
