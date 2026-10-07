// The placements of one primitive share its records, and the cache holds records,
// never instances: so the closure holds a group once per primitive, at the packed ranks of the
// placement that first asked for it, however many placements the cut selects it on. Its tables
// follow the records the view closes over, never every placement selected.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ruleDag } from './cutRule.fixture.ts'
import { createGroupClosure } from './groupClosure.ts'
import type { PageRec } from '../selection/selection.ts'
import type { ClusterRoot } from '../selection/types.ts'

const dag = ruleDag(64),
  n = dag.pages.length,
  leaves = dag.pages.map((_, p) => p).filter((p) => dag.pages[p].level === 0)

/** `count` placements of the DAG sharing its page list, packed one after the other. */
function placements(count: number) {
  const roots = Array.from({ length: count }, () => ({
    world: dag.world,
    structure: dag.structure,
    pages: dag.pages,
  })) as unknown as ClusterRoot<PageRec>[]
  const placement = {
    baseOfRoot: Int32Array.from({ length: count }, (_, r) => r * n),
    rootOfPacked: Int32Array.from({ length: count * n }, (_, id) => Math.floor(id / n)),
  }
  const packed = roots.flatMap((root) => root.pages)
  return createGroupClosure(roots, placement, packed)
}

const cut = (ids: number[], exits = false) => {
  const list = Int32Array.from(ids),
    none = new Int32Array(0)
  return {
    entered: exits ? none : list,
    exited: exits ? list : none,
    enteredCount: exits ? 0 : ids.length,
    exitedCount: exits ? ids.length : 0,
    has: () => false,
  }
}
/** Every leaf of every placement: a cut that selects the whole primitive on each. */
const everyLeaf = (count: number) =>
  Array.from({ length: count }, (_, r) => leaves.map((leaf) => r * n + leaf)).flat()

test('a primitive selected on many placements holds its groups once, at its first placement', () => {
  const one = placements(1)
  one.apply(cut(leaves))
  const single = [...one.delta.entered.subarray(0, one.delta.enteredCount)].sort((a, b) => a - b)
  const many = placements(512)
  // The cut first selects placement 7: its packed ranks name the records for every placement.
  many.apply(cut([7 * n + leaves[0], ...everyLeaf(512)]))
  const held = [...many.delta.entered.subarray(0, many.delta.enteredCount)].sort((a, b) => a - b)
  assert.deepEqual(
    held,
    single.map((id) => 7 * n + id),
    'the same records as one placement holds',
  )
  // A word per packed id, up to the holder's ranks (`denseInts.ts`): the tables of eight
  // placements, the holder the eighth, whatever the placements past it.
  const eight = placements(8)
  eight.apply(cut([7 * n + leaves[0], ...everyLeaf(8)]))
  assert.equal(many.hostBytes, eight.hostBytes, 'tables up to the holder, not of 512 placements')
  const first = placements(1)
  first.apply(cut([leaves[0]]))
  const kept = first.delta.enteredCount
  many.apply(cut(everyLeaf(512), true))
  assert.equal(many.delta.exitedCount, held.length - kept, 'what placement 7 still selects stays')
  many.apply(cut([7 * n + leaves[0]], true))
  assert.equal(many.delta.exitedCount, kept, 'its last exit lets the rest go')
})

test('a rebuilt list visits each record once whatever the placements it is asked on', () => {
  const closure = placements(64)
  const visited: number[] = []
  closure.closeOver(everyLeaf(64), (id) => visited.push(id))
  assert.ok(
    visited.every((id) => id < n),
    'named at the first placement asked',
  )
  assert.equal(new Set(visited).size, visited.length, 'each record once')
})
