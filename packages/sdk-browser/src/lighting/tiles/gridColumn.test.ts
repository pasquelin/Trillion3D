// A column of the light grid injects its lights into its cells by chains of links and writes the
// chains as lists, each in increasing light order. Everything is an integer: on random series —
// full depth, more lights than lanes, pools that overflow — the shipped routines give the serial
// column's counts and lists, column after column; a pool that overflows keeps, in each cell, the
// first lights it was asked for.
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRID_SLICES,
  TILE_SHADOWED,
  countWord,
  fullLists,
  listsOf,
  openPool,
  serialColumn,
  serialFixedColumn,
  shippedColumn,
  suns,
  type Run,
} from './gridColumn.fixture.ts'
import { createGpuLightTiles } from './tiles.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { withinDefaults } from '../../gpu/core/stageLimits.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

/** `count` lights of a column: a share full depth, a share meeting no cell, the others a run. */
function series(seed: number, count: number, full: number, none: number): Run[] {
  const r = lcgRandom(seed),
    slice = () => Math.floor(r() * GRID_SLICES)
  return Array.from({ length: count }, () => {
    const pick = r(),
      slot = r() < 0.3
    if (pick < full) return { first: 0, last: GRID_SLICES - 1, slot }
    if (pick < full + none) return null
    const [a, b] = [slice(), slice()]
    // Short runs mostly, as a lamp's across a doubling of the depth; some long ones.
    const last = r() < 0.7 ? Math.min(GRID_SLICES - 1, a + Math.floor(r() * 16)) : Math.max(a, b)
    return { first: Math.min(a, last), last, slot }
  })
}

/** Columns in one roomy pool, shipped in batches of `lanes` and serial: the same counts, lists and
 *  allocators. */
function same(columns: Run[][], lanes = WORKGROUP_THREADS) {
  const shipped = openPool(1 << 22),
    serial = openPool(1 << 22)
  columns.forEach((runs, i) => {
    const got = shippedColumn(runs, shipped, { lanes }),
      want = serialColumn(runs, serial)
    assert.deepEqual(got.counts, want.counts, `column ${i}: counts`)
    assert.deepEqual(listsOf(got), listsOf(want), `column ${i}: lists`)
    assert.deepEqual(shipped, serial, `column ${i}: pool`)
  })
  return shipped
}

test('random columns: the counts, lists and allocators of the serial column, in light order', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const r = lcgRandom(seed * 7919)
    const columns = [0, 1, 2].map((k) =>
      series(seed * 3 + k, Math.floor(r() * (seed % 4 === 0 ? 900 : 200)), r() * 0.3, r() * 0.4),
    )
    const pool = same(columns)
    // Every link asked was held, and as many words of lists were handed out.
    assert.equal(pool.head, pool.links, `seed ${seed}`)
  }
})

test('full depth: every light a sun, past the lanes', () => {
  same([suns(1), suns(WORKGROUP_THREADS + 1), suns(3 * WORKGROUP_THREADS + 3)])
  // Its lane bit stands for every slice: no slice's mask is ever marked.
  assert.equal(shippedColumn(suns(3 * WORKGROUP_THREADS + 3), openPool(1 << 22)).marks, 0)
  assert.equal(shippedColumn([{ first: 2, last: 4, slot: false }], openPool(1 << 22)).marks, 3)
  // A sun, then lights that leave its lane: its bit is cleared, its slices not marked again.
  const mixed: Run[] = [
    ...suns(WORKGROUP_THREADS),
    ...Array.from({ length: WORKGROUP_THREADS }, (_, i) =>
      i % 2 ? null : { first: i, last: i + 3, slot: false },
    ),
    ...suns(5),
  ]
  same([mixed, [], mixed])
})

test('a batch of any width: its lane masks hold every lane, no slice reads its neighbour', () => {
  // A width occupancy may tune `WORKGROUP_THREADS` to: one mask word, or four.
  for (const lanes of [32, 128])
    same([series(3, 300, 0.1, 0.2), suns(lanes + 5), series(9, lanes * 3, 0, 0.1)], lanes)
})

test('a cell that holds a shadow slot says so in its count, and only then', () => {
  const runs: Run[] = [
    { first: 1, last: 3, slot: false },
    { first: 3, last: 5, slot: true },
  ]
  const { counts } = shippedColumn(runs, openPool(1 << 10))
  assert.deepEqual(
    [counts[0], counts[1], counts[3], counts[4], counts[6]],
    [0, 1, (2 | TILE_SHADOWED) >>> 0, (1 | TILE_SHADOWED) >>> 0, 0],
  )
})

test('a pool of too few links keeps, in each cell, the first lights it was asked for', () => {
  const columns = [series(5, 150, 0.1, 0.2), series(6, 150, 0.1, 0.2), []]
  const total = columns.reduce(
    (sum, runs) => sum + fullLists(runs).reduce((cells, list) => cells + list.length, 0),
    0,
  )
  const asked = (all: Run[][]) =>
    all.reduce((sum, runs) => sum + fullLists(runs).reduce((n, list) => n + list.length, 0), 0)
  // The last: the links run out in the middle of a batch, of suns holding every slice.
  const batch = [suns(40)]
  const cases: [Run[][], number][] = [
    ...[0, 1, 63, 2000, Math.floor(total / 2), total - 1].map((capacity): [Run[][], number] => [
      columns,
      capacity,
    ]),
    [batch, Math.floor(asked(batch) / 3)],
  ]
  for (const [all, capacity] of cases) {
    const pool = openPool(capacity)
    let kept = 0
    all.forEach((runs, i) => {
      const column = shippedColumn(runs, pool)
      listsOf(column).forEach((list, slice) => {
        kept += list.length
        const wanted = fullLists(runs)[slice]
        const where = `${capacity}, column ${i}, cell ${slice}`
        assert.deepEqual(list, wanted.slice(0, list.length), where)
        assert.equal(column.counts[slice], countWord(wanted.slice(0, list.length), runs))
      })
    })
    // The pool counts every entry asked, the lists hold the first ones.
    const want = [asked(all), Math.min(capacity, asked(all)), kept]
    assert.deepEqual([pool.links, kept, pool.head], want)
  }
})

test('past half the word’s range the count of entries asked stops, and the entries are dropped', () => {
  for (const perCell of [0, 4]) {
    const pool = { ...openPool(1 << 20), links: 0x80000000 }
    const column = shippedColumn(series(2, 100, 0.1, 0.2), pool, { perCell })
    assert.equal(pool.links, 0x80000000, 'not counted further')
    assert.ok(pool.links > pool.head, 'an overflow still')
    if (!perCell) assert.ok(column.counts.every((count) => count === 0))
  }
})

test('cells with words of their own: each keeps its first lights up to its share and the pool', () => {
  const runs = series(7, 400, 0.1, 0.2)
  for (const perCell of [1, 4, 32, 600]) {
    const shipped = openPool(1 << 20),
      serial = openPool(1 << 20)
    const got = shippedColumn(runs, shipped, { perCell, columnCell: 3 * GRID_SLICES })
    const want = serialFixedColumn(runs, serial, perCell, 3 * GRID_SLICES)
    assert.deepEqual(got.counts, want.counts, `${perCell}: counts`)
    assert.deepEqual(got.starts, want.starts, `${perCell}: starts`)
    assert.deepEqual(listsOf(got), listsOf(want), `${perCell}: lists`)
    assert.deepEqual(shipped, serial, `${perCell}: pool`)
  }
  // Cells past what the pool holds keep nothing: more entries asked than held.
  const tight = openPool(40),
    serial = openPool(40)
  const column = shippedColumn(runs, tight, { perCell: 4 })
  assert.deepEqual(column.counts, serialFixedColumn(runs, serial, 4).counts)
  assert.ok(tight.links > tight.head)
  assert.deepEqual(tight, serial)
})

test('with room for all, chains of links and cells with words of their own make the same lists', () => {
  const runs = series(11, 250, 0.1, 0.2)
  const chains = shippedColumn(runs, openPool(1 << 22))
  const own = shippedColumn(runs, openPool(1 << 22), { perCell: 600 })
  assert.deepEqual(listsOf(chains), listsOf(own))
  assert.deepEqual(chains.counts, own.counts)
})

test('the pass binds the storage buffers a stage may', async () => {
  const fake = fakeDevice()
  await createGpuLightTiles(fake.device)
  withinDefaults(fake.pipelineLayouts, 'lightTiles')
})
