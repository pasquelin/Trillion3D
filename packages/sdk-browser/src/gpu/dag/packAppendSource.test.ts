// A source of another surface appended to a packing in place, on the records of the primitive it
// draws (`appendDagRoots`): the tables then read as a packing of every root, and what is written
// follows the sources added, never the placements held.
import test from 'node:test'
import assert from 'node:assert/strict'
import { appendDagRoots, dagRootCounts, packDagSelection } from './pack.ts'
import { scene, TABLES } from './packAppend.fixture.ts'
import * as G from '../../host/graph/graph.fixture.ts'
import { scenePages, sceneRoots } from './cutFrontierScene.fixture.ts'
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

test('a world DAG is never appended: its links reach every placement, a cut is packed with it', () => {
  const { roots, capacity } = scene()
  const grown = packDagSelection(roots.slice(0, 3), capacity)
  const world = { ...roots[3], origins: new Int32Array(roots[3].pages.length).fill(-1) }
  assert.equal(appendDagRoots(grown, [world as DagRoot]), undefined)
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

test('a primitive the packing does not hold appends into the room it kept, as a packing of all reads', () => {
  const { roots } = scene()
  const other = sceneRoots(scenePages(64, 3), [new G.Matrix4().makeTranslation(40, 0, 0)], true)
  const all = [...roots, ...other]
  const exact = packDagSelection(all)
  const capacity = {
    pages: 2 * exact.pageCount,
    nodes: 2 * exact.entryCount,
    worlds: 2 * exact.worldCount,
    primitiveNodes: exact.primitiveNodeCount,
    records: exact.recordCount,
    keys: exact.keyCount,
    groups: exact.groupCount,
    edges: exact.groupEdges,
  }
  const whole = packDagSelection(all, capacity),
    grown = packDagSelection(roots, capacity)
  const added = appendDagRoots(grown, other)!
  assert.ok(added, 'appended in place')
  for (const table of TABLES) assert.deepEqual(grown[table], whole[table], table)
  assert.equal(grown.recordCount, whole.recordCount)
  assert.equal(grown.keyCount, whole.keyCount)
  assert.deepEqual(grown.live, whole.live)
  assert.ok(added.nodes[1] > added.nodes[0] && added.records[1] > added.records[0])
})

test('a primitive past the nodes, records or keys the room kept is not appended', () => {
  const { roots } = scene()
  const other = sceneRoots(scenePages(64, 3), [new G.Matrix4()], true)
  const exact = packDagSelection([...roots, ...other])
  const room = {
    pages: 2 * exact.pageCount,
    nodes: 2 * exact.entryCount,
    worlds: 2 * exact.worldCount,
  }
  const none = packDagSelection(roots, room)
  assert.equal(appendDagRoots(none, other), undefined, 'no room for its nodes')
  const nodesOnly = packDagSelection(roots, { ...room, primitiveNodes: exact.primitiveNodeCount })
  assert.equal(appendDagRoots(nodesOnly, other), undefined, 'none for its records')
})

test('a packing kept ahead takes a source of records of its own in the room it kept, and no more', () => {
  const { roots } = scene()
  const held = roots.slice(0, 3),
    first = otherSource(roots.slice(3, 4), { transparent: true }),
    second = roots.slice(4).map((root) => ({
      ...root,
      pages: root.pages.map((rec) => ({ ...rec, lodError: (rec.lodError ?? 0) + 1 })),
    }))
  const exact = packDagSelection(held)
  const counts = dagRootCounts([...held, ...first, ...second])
  const room = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 16, ahead: true }
  const packed = packDagSelection(held, room)
  assert.ok(packed.primitiveNodeCount >= exact.primitiveNodeCount + 64, 'room for primitives')
  assert.ok(packed.recordCount >= exact.recordCount + 64, 'room for records')
  assert.ok(packed.keyCount >= exact.keyCount + 64, 'room for keys')
  assert.ok(packed.groupCount >= exact.groupCount + 64, 'room for key groups')
  assert.ok(appendDagRoots(packed, first), 'a source of records of its own is appended in place')
  // As a packing of every root at the room it kept: its primitive nodes, records and keys.
  const kept = {
    ...{ pages: room.pages, nodes: room.nodes, worlds: room.worlds },
    ...{ primitiveNodes: packed.primitiveNodeCount, records: packed.recordCount },
    keys: packed.keyCount,
    groups: packed.groupCount,
    edges: packed.groupEdges,
  }
  const whole = packDagSelection([...held, ...first], kept)
  for (const table of TABLES) assert.deepEqual(packed[table], whole[table], table)
  assert.deepEqual(packed.live, whole.live)
  // The room doubled once for the records the live ones held: a second source of the same size
  // asks the packing again, at its own doubling.
  assert.equal(appendDagRoots(packed, second), undefined)
})

test('the placements of one source bring its records once, however many they are', () => {
  const { roots } = scene()
  const [only] = roots
  // A thousand placements of one source whose surface is not the held one's: its records are
  // written once for all of them, and the room counts them once.
  const world = (k: number) => {
    const elements = new Float64Array(16)
    elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, k, 0, 0, 1])
    return { elements }
  }
  const pages = only.pages.map((rec) => ({ ...rec, transparent: true }))
  const source = Array.from({ length: 1000 }, (_, k) => ({ ...only, pages, world: world(k) }))
  const counts = dagRootCounts([only, ...source])
  const packed = packDagSelection([only], {
    pages: 2 * counts.pages,
    nodes: 2 * counts.nodes,
    worlds: 2 * counts.worlds,
    ahead: true,
  })
  assert.ok(appendDagRoots(packed, source as DagRoot[]), 'the room takes its records once')
  assert.equal(packed.live!.worlds, 1001)
})
