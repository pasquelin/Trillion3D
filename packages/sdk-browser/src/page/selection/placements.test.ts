// A packed rank names its root through the roots' first ranks alone (`rootOfPacked`): the index
// holds a word a root, never one a page, and reads every rank as the per-page table it replaces
// did — empty roots included, ranks past the packing none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { postPackedBases, rootOfPacked } from './placements.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

test('a packed rank is its root’s, empty roots skipped, past the packing none', () => {
  const next = lcgRandom(5)
  for (let layout = 0; layout < 50; layout++) {
    const counts = Array.from({ length: 1 + Math.floor(next() * 40) }, () =>
      next() < 0.3 ? 0 : Math.floor(next() * 9),
    )
    const roots = counts.map((n) => ({ pages: new Array(n).fill(0) }))
    const index = postPackedBases(roots)
    const owner = counts.flatMap((n, rank) => new Array<number>(n).fill(rank))
    assert.equal(index.packedCount, owner.length)
    for (let packed = -2; packed < owner.length + 3; packed++)
      assert.equal(rootOfPacked(index, packed), owner[packed] ?? -1, `layout ${layout}, ${packed}`)
    // In any order: the root found last only spares a search.
    for (let k = 0; k < 40; k++) {
      const packed = Math.floor(next() * (owner.length + 4)) - 2
      assert.equal(rootOfPacked(index, packed), owner[packed] ?? -1, `layout ${layout}, ${packed}`)
    }
  }
})

test('the index holds a word a root, whatever the pages', () => {
  for (const pages of [1, 1000, 100_000]) {
    const roots = Array.from({ length: 50 }, () => ({ pages: { length: pages } as unknown[] }))
    const index = postPackedBases(roots)
    const words = Object.values(index).reduce(
      (sum: number, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength / 4 : 0),
      0,
    )
    assert.equal(words, roots.length, `${pages} pages a root`)
    assert.equal(rootOfPacked(index, 50 * pages - 1), 49)
  }
})
