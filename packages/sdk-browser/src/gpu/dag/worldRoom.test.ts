// A packing that holds the world DAG kept no room: every growth of a world session packed and sent
// the whole cut again, its cost following the world. Its rank named, it keeps room as any other:
// later placements append in place, each with a link slot to the world. On the cook's world.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldScene } from './worldScene.fixture.ts'
import { appendDagRoots, dagRootCounts, packDagSelection } from './pack.ts'
import { SELECTION_NONE as NONE } from '../core/selection.ts'

test('a packing of the world DAG keeps room: placements append in place, linked as the others', () => {
  const { roots } = worldScene()
  // Placements, then the world DAG, then two more placements of the first one's primitive, which
  // a growth brings.
  const world = roots.at(-1)!,
    placements = roots.slice(0, -1),
    later = [5, 6].map((x) => ({
      ...placements[0],
      world: { elements: Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 1, 0, 1) },
    })),
    before = [...placements, world],
    after = [...before, ...later]
  const counts = dagRootCounts(after),
    capacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 2 * after.length }
  const grown = packDagSelection(before, capacity),
    whole = packDagSelection(after, capacity)
  const added = appendDagRoots(grown, later)
  assert.ok(added, 'appended in place')
  assert.deepEqual(added.worlds, [before.length, after.length])
  for (const table of ['clusters', 'nodes', 'pageCones', 'worlds', 'levelSizes'] as const)
    assert.deepEqual(grown[table], whole[table], table)
  assert.equal(grown.world!.root, before.length - 1, 'the world DAG where it was packed')
  assert.equal(grown.world!.links.length, capacity.worlds, 'a link slot per placement slot')
  assert.ok(grown.world!.links.every((link) => link === NONE))
})
