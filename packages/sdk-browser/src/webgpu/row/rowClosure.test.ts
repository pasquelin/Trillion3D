// The rows' closure stamps exactly what a page's readiness needs in its own placement: on generated
// structures shared by many placements, the rows it raises are the rows of the pages the CPU's
// per-instance closure holds (`createGroupClosure`, `instances`), whatever the seeds' order — and a
// row the host stamped "used now" still lets the walk through, the gate being the walk word alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { structureFamily } from '../../gpu/dag/structureFamily.fixture.ts'
import { createGroupClosure } from '../../page/cut/groupClosure.ts'
import { postPackedBases, rootOfPacked } from '../../page/selection/placements.ts'
import { createPackedPages } from '../../page/selection/catalogue.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'
import { closeRows, type ClosureSeed } from './rowClosure.fixture.ts'
import { ROW_USE, ROW_USE_WORDS, ROW_WALK } from './rowWords.ts'

/** `count` placements over `kinds` generated structures, a page in three holding a row. */
function scene(seed: number, count: number, kinds: number) {
  const random = lcgRandom(seed)
  const structures = Array.from({ length: kinds }, (_, k) =>
    structureFamily(seed * 31 + k, 16 + 9 * k),
  )
  const arrays = structures.map((s) =>
    Array.from(
      { length: s.owners.length },
      (_, p) => ({ url: `s${s.groupCount}/${p}` }) as PageRec,
    ),
  )
  const roots = Array.from({ length: count }, () => {
    const k = Math.floor(random() * kinds)
    return { world: { elements: [] }, structure: structures[k], pages: arrays[k] }
  }) as unknown as ClusterRoot<PageRec>[]
  const placement = postPackedBases(roots),
    packed = createPackedPages(roots, placement)
  const rows = new Map<number, number>()
  for (let page = 0; page < placement.packedCount; page++)
    if (random() < 1 / 3) rows.set(page, rows.size)
  const placements = roots.map((root, w) => ({
    pageBase: placement.baseOfRoot[w],
    structure: root.structure,
  }))
  return { random, roots, placement, packed, rows, placements }
}

/** The rows the CPU closure holds for `seeds`, each placement's own pages. */
function expectedRows(s: ReturnType<typeof scene>, seeds: readonly ClosureSeed[]) {
  const closure = createGroupClosure(s.roots, s.placement, s.packed, true)
  const held = new Set<number>()
  closure.closeOver(
    seeds.map((seed) => seed.page),
    (page) => {
      const row = s.rows.get(page)
      if (row !== undefined) held.add(row)
    },
    undefined,
    true,
  )
  return [...held].sort((a, b) => a - b)
}

/** The rows `closeRows` raised to `v` over a fresh table. */
function stampedRows(s: ReturnType<typeof scene>, seeds: readonly ClosureSeed[], v: number) {
  const use = new Uint32Array(s.rows.size * ROW_USE_WORDS)
  closeRows(seeds, s.placements, (page) => s.rows.get(page) ?? -1, use)
  const rows: number[] = []
  for (let row = 0; row < s.rows.size; row++)
    if (use[row * ROW_USE_WORDS + ROW_USE] === v) rows.push(row)
  return { rows, use }
}

test('the rows raised are those the per-instance closure holds, 1 to 1000 placements', () => {
  for (const [seed, count] of [
    [1, 1],
    [2, 10],
    [3, 1000],
  ]) {
    const s = scene(seed, count, 3)
    const seeds = Array.from({ length: Math.min(200, 4 * count) }, () => {
      const page = Math.floor(s.random() * s.placement.packedCount)
      const placement = rootOfPacked(s.placement, page)
      return { page, placement, value: 9 }
    })
    assert.deepEqual(stampedRows(s, seeds, 9).rows, expectedRows(s, seeds), `seed ${seed}`)
    const reversed = stampedRows(s, [...seeds].reverse(), 9)
    assert.deepEqual(reversed.rows, expectedRows(s, seeds), 'whatever the seeds order')
  }
})

test('a row the host stamped used now still opens its group: the gate is the walk word', () => {
  const s = scene(4, 1, 1)
  const st = s.placements[0].structure!
  // A page in a group, holding a row: its walk opens at least its group.
  let page = -1
  for (let p = 0; p < st.owners.length && page < 0; p++)
    if (st.owners[p] >= 0 && s.rows.has(p)) page = p
  assert.ok(page >= 0)
  const seeds = [{ page, placement: 0, value: 5 }]
  const use = new Uint32Array(s.rows.size * ROW_USE_WORDS)
  for (let row = 0; row < s.rows.size; row++) use[row * ROW_USE_WORDS + ROW_USE] = 5
  closeRows(seeds, s.placements, (p) => s.rows.get(p) ?? -1, use)
  const fresh = stampedRows(s, seeds, 5).use
  for (let row = 0; row < s.rows.size; row++)
    assert.equal(
      use[row * ROW_USE_WORDS + ROW_WALK],
      fresh[row * ROW_USE_WORDS + ROW_WALK],
      `row ${row} walked`,
    )
})
