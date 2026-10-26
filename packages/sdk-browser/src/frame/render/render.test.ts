import test from 'node:test'
import assert from 'node:assert/strict'
import { invalidateOccluderHistory } from '../io/drops.ts'
import { moveRootRows } from './movedRoot.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'
import type { RootWorlds } from '../../placement/roots/rootWorlds.ts'

// "Occluder history" lever: the history names pages only, so only what changes the pages drawn
// drops it.
test('invalidateOccluderHistory drops the occluder history', () => {
  const run = { noOccluderHistory: false } as unknown as Parameters<
    typeof invalidateOccluderHistory
  >[0]
  invalidateOccluderHistory(run)
  assert.equal(run.noOccluderHistory, true)
})

// A moved model writes no cluster: its world goes up, 128 bytes, and the decode of the clusters it
// draws reads it there (`../../visibility/decode/`). The scene's occlusion history is not dropped by
// a move: that would redraw every corner and every transparent corner each image a model moved. A
// world that turned its winding has it taken again, which the bins read to cull the other face.

/** A root of `count` clusters, all placed by the same world, its winding held. */
function root(name: string, count: number, transparent = false): ClusterRoot<PageRec> {
  const world = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }
  const pages = Array.from(
    { length: count },
    (_, i) => ({ url: `${name}${i}`, transparent }) as unknown as PageRec,
  )
  return { world, pages, windingEpoch: 1, windingCw: false }
}

/** A terrain of `terrain` clusters, then a model of `model` clusters, and glass that claims none. */
function scene(terrain: number, model: number) {
  const ground = root('t', terrain),
    moving = root('m', model),
    glass = root('g', 2, true)
  // The packed base of each placement: the packed ranks name each page's instance.
  ground.packedBase = 0
  moving.packedBase = terrain
  glass.packedBase = terrain + model
  const rt = {
    blendState: { occlusionEpoch: 1 },
    rootWorlds: undefined as RootWorlds | undefined,
  }
  return { rt, moving, glass }
}

test('a model moved in a scene writes no cluster: its world is named', () => {
  const { rt, moving } = scene(900, 12)
  ;(moving.world.elements as Float64Array)[12] = 3
  moveRootRows(rt, moving, 7)
  assert.deepEqual([...rt.rootWorlds!.moved.take()], [7], 'its world alone goes up')
  assert.equal(moving.windingEpoch, moving.worldAt, 'its winding held, at its new version')
  assert.equal(rt.blendState.occlusionEpoch, 1, 'no transparent cluster moved')
})

test('a mirrored model has its winding computed again', () => {
  const { rt, moving } = scene(900, 12)
  const movingWorld = moving.world.elements as Float64Array
  movingWorld[0] = -1
  moveRootRows(rt, moving, 0)
  assert.equal(moving.windingCw, true, 'its winding taken again')
  assert.equal(moving.windingEpoch, moving.worldAt, 'at its new world version')
})

test('a transparent model claims no cluster: its corners are sent again', () => {
  const { rt, glass } = scene(4, 2)
  moveRootRows(rt, glass, 0)
  assert.equal(rt.blendState.occlusionEpoch, -1)
})
