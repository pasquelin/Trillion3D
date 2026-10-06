// #1235: one record serves every row of its page. A frame that shows the same record on another row
// shows the same records as the last frame, but at other matrices: the instanced batch draws again.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { createWebglPageBatches } from './webglPageBatches.ts'
import { createPageDraws } from '../backend/autonomous/pageDraws.ts'
import { makeRec } from '../backend/autonomous/pageRec.fixture.ts'
import type { ClusterRoot, PageRec } from '../page/selection/types.ts'
import type { HostInstancedMesh } from '../host/resources.ts'
import type { Scene } from '../world/core/scene.ts'

test('the instanced batch draws again when another row takes over the same record', () => {
  const rec = makeRec(0, 1),
    pages = [rec]
  const roots: ClusterRoot<PageRec>[] = [1, 2].map((x) => ({
    world: new G.Matrix4().makeTranslation(x, 0, 0),
    pages,
    placement: {} as never,
  }))
  const draws = createPageDraws(roots)
  draws.forEachDraw(rec, (draw) => (draw.geometry = new G.Geometry() as never))
  const meshes: HostInstancedMesh[] = []
  const scene = { add: (mesh: HostInstancedMesh) => meshes.push(mesh), remove() {} }
  const batches = createWebglPageBatches(scene as unknown as Scene, roots, draws)
  /** The x of the batch's first instance matrix. */
  const firstX = () => meshes[0].instanceMatrix.array[12]
  batches.draw([rec], [0])
  assert.equal(firstX(), 1, 'the first row draws')
  batches.draw([rec], [1])
  assert.equal(firstX(), 2, 'the same record on the second row draws at its matrix')
})
