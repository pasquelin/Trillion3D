// A source of another surface appended to a packing in place, on the records of the primitive it
// draws (`appendDagRoots`): the tables then read as a packing of every root, and what is written
// follows the sources added, never the placements held.
import test from 'node:test'
import assert from 'node:assert/strict'
import { appendDagRoots, dagRootCounts, packDagSelection } from './pack.ts'
import { scene, TABLES } from './packAppend.fixture.ts'
import { DAG_NODE_FLOATS, type DagRoot } from './types.ts'

/** `roots` drawn by another source of the same primitive: the page array a new surface makes. */
const otherSource = (roots: DagRoot[], flags: { transparent?: boolean } = {}) =>
  roots.map((root) => ({ ...root, pages: root.pages.map((rec) => ({ ...rec, ...flags })) }))

test('roots of another source of a packed primitive append on its records, as a packing of all reads', () => {
  const { roots, capacity } = scene()
  const worn = [...roots.slice(0, 3), ...otherSource(roots.slice(3))]
  const whole = packDagSelection(worn, capacity),
    grown = packDagSelection(worn.slice(0, 3), capacity)
  assert.notEqual(worn[3].pages, roots[0].pages, 'a page array of its own')
  assert.ok(appendDagRoots(grown, worn.slice(3)), 'appended in place')
  for (const table of TABLES) assert.deepEqual(grown[table], whole[table], table)
  assert.equal(grown.recordCount, whole.recordCount, 'no record added: the words are the same')
})

test('a source whose records differ from the primitive’s is not appended: it needs its own', () => {
  const { roots, capacity } = scene()
  const grown = packDagSelection(roots.slice(0, 3), capacity)
  assert.equal(appendDagRoots(grown, otherSource(roots.slice(3), { transparent: true })), undefined)
  assert.equal(grown.live!.worlds, 3, 'nothing moved')
})

test('a source appended writes what it adds — its pages and placements — whatever the placements held', () => {
  const written: Record<number, number[]> = {}
  for (const side of [16, 32, 64]) {
    const [root] = scene().roots,
      field = Array.from({ length: side * side }, (_, k) => {
        const world = new Float64Array(16)
        world.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, k, 0, 0, 1])
        return { ...root, world: { elements: world } } as DagRoot
      }),
      held = field.length,
      per = field[0].pages.length
    for (const added of [1, 100]) {
      const worn = otherSource(field.slice(0, added))
      const counts = dagRootCounts([...field, ...worn])
      const packed = packDagSelection(field, {
        pages: 2 * counts.pages,
        nodes: 2 * counts.nodes,
        worlds: 2 * counts.worlds,
      })
      const [clusters, nodes, records] = [
        packed.clusters.slice(),
        packed.nodes.slice(),
        packed.recordCount,
      ]
      const appended = appendDagRoots(packed, worn)!
      assert.deepEqual(appended.pages, [held * per, (held + added) * per])
      assert.deepEqual(appended.worlds, [held, held + added])
      assert.deepEqual(packed.clusters, clusters, 'the records are the primitive’s: none rewritten')
      // No primitive node: the placements read their primitive's; the tree's nodes it joined are
      // the only node rows rewritten.
      const rewritten = new Set<number>()
      for (let i = 0; i < nodes.length; i++)
        if (nodes[i] !== packed.nodes[i]) rewritten.add(Math.floor(i / DAG_NODE_FLOATS))
      assert.ok([...rewritten].every((node) => appended.tree.nodes.includes(node)))
      assert.equal(packed.recordCount, records)
      ;(written[added] ??= []).push(appended.pages[1] - appended.pages[0])
    }
  }
  const per = scene().roots[0].pages.length
  assert.deepEqual(written[1], [per, per, per], 'one placement, at 256, 1024 or 4096 held')
  assert.deepEqual(written[100], [100 * per, 100 * per, 100 * per])
})
