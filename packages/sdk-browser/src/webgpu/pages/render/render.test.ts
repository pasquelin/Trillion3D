// The occluder history follows the drawn view's fingerprint (`../../../frame/viewRevision.ts`): a
// still view keeps it, a moved view, projection or viewport lets every row leave the occluders
// again, and a motion a held image read stays owed to the next drawn one.
import { runsOf } from '../../row/dirty.fixture.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { invalidateOccluderHistory } from '../io/drops.ts'
import { createFrameGateCore } from '../../../frame/gateCore.ts'
import { engineCamera } from '../../../camera/camera.fixture.ts'
import { moveRootRows } from './movedRoot.ts'
import { createWebgpuRowState } from '../../row/state.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'
import { ROW_WORDS } from '../../../visibility/types.ts'
import type { RootWorlds } from '../../../placement/rootWorlds.ts'

const VIEWPORT: [number, number] = [800, 600]

/** A gate and a camera five units back; `read` is frame entry's view read, `draw` a drawn image's
 *  read then take, as `renderWebgpuPages` does. */
function occluderViews() {
  const gate = createFrameGateCore(1),
    camera = G.perspectiveCamera(55, 16 / 9, 0.1, 200)
  camera.position.z = 5
  camera.updateMatrixWorld()
  const read = (cam = camera, error = 1) => gate.viewChanged(engineCamera(cam), VIEWPORT, error)
  const draw = (cam = camera) => (read(cam), gate.takeViewMoved())
  return { gate, camera, read, draw }
}

test('a still view keeps the occluder history; a moved view or projection leaves it', () => {
  const { camera, draw } = occluderViews()
  assert.equal(draw(), true, 'the first image has no history')
  assert.equal(draw(), false, 'a still view keeps it')
  camera.position.x = 1
  camera.updateMatrixWorld()
  assert.equal(draw(), true, 'a moved view leaves it')
  assert.equal(draw(), false, 'still again: kept')
  camera.fov = 75
  camera.updateProjectionMatrix()
  assert.equal(draw(), true, 'a projection cut leaves it')
})

test('the far plane and the quality threshold move the frame hold, not the occluders', () => {
  const { camera, read, draw } = occluderViews()
  draw()
  assert.equal(read(camera, 2), true, 'the hold sees the threshold')
  camera.far = 400
  assert.equal(read(), true, 'the hold sees the far plane')
  assert.equal(draw(), false, 'the occluders see neither: view and projection stood still')
})

test('a motion a held image read stays owed to the next drawn image', () => {
  const { camera, read, draw } = occluderViews()
  draw()
  camera.position.x = 2
  camera.updateMatrixWorld()
  read()
  assert.equal(draw(), true, 'the drawn image after the held one still sees the motion')
  assert.equal(draw(), false)
})

test('NaN in the world matrix never reports a still view', () => {
  const { camera, draw } = occluderViews()
  draw()
  // A NaN enters through the local pose: the engine camera inverts the world matrix.
  camera.position.x = NaN
  camera.updateMatrixWorld()
  assert.equal(draw(), true)
  assert.equal(draw(), true, 'NaN never compares equal to itself')
})

// "Occluder history" lever: the history names pages only, so only what changes the pages drawn
// drops it; a moving camera lets its rows leave the occluders instead (`occluderViewMoved`).
test('invalidateOccluderHistory drops the occluder history', () => {
  const run = { noOccluderHistory: false } as unknown as Parameters<
    typeof invalidateOccluderHistory
  >[0]
  invalidateOccluderHistory(run)
  assert.equal(run.noOccluderHistory, true)
})

// A moved model writes no row: its world goes up, 128 bytes, and the rows pass derives its rows'
// words from it (`../../../placement/rowWords.ts`). The table's age must not advance on every
// move: that would write every row, every corner and every transparent corner again, and drop the
// whole scene's occlusion history, each image a model moved. A world that turned its winding
// writes its own rows again, never the scene's: their draw bins cull the other face.

/** A root of `count` clusters, all placed by the same world, its winding held. */
function root(name: string, count: number, transparent = false): ClusterRoot<PageRec> {
  const world = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }
  const pages = Array.from(
    { length: count },
    (_, i) => ({ url: `${name}${i}`, transparent }) as unknown as PageRec,
  )
  return { world, pages, windingEpoch: 1, windingCw: false }
}

/** A terrain of `terrain` rows, then a model of `model` rows, every cluster resident; then
 *  `blendSlots` shadow-only rows for the glass. */
function scene(terrain: number, model: number, blendSlots = 0) {
  const ground = root('t', terrain),
    moving = root('m', model),
    glass = root('g', 2, true)
  // The packed base of each placement: the rows of the layout name each page's instance.
  ground.packedBase = 0
  moving.packedBase = terrain
  glass.packedBase = terrain + model
  const pages = [...ground.pages, ...moving.pages, ...glass.pages]
  const rows = createWebgpuRowState(pages, terrain + model, blendSlots, undefined, () => -1)
  rows.pageTableFloats = new Float32Array(rows.casterSlots * ROW_WORDS)
  for (let row = 0; row < terrain + model; row++) {
    rows.setRowOf(row, row)
    rows.packedPageIndex[row] = row
  }
  rows.packedCount = terrain + model
  const rt = {
    layout: { rows },
    blendState: { occlusionEpoch: 1 },
    rootWorlds: undefined as RootWorlds | undefined,
  }
  return { rt, rows, moving, glass }
}

test('a model of N rows moved in a scene of M rows writes no row: its world is named', () => {
  const terrain = 900,
    model = 12
  const { rt, rows, moving } = scene(terrain, model)
  const before = rows.pageTableFloats!.slice()
  ;(moving.world.elements as Float64Array)[12] = 3
  assert.equal(moveRootRows(rt, moving, 7), 0)
  assert.equal(rows.dirtyCount, 0, 'no row travels')
  assert.deepEqual([...rt.rootWorlds!.moved.take()], [7], 'its world alone goes up')
  assert.equal(rows.tableEpoch, 1, 'the table keeps its age')
  assert.deepEqual(rows.pageTableFloats, before, 'no word of the table written')
  assert.equal(moving.windingEpoch, 1, 'its winding held')
  assert.equal(rt.blendState.occlusionEpoch, 1, 'no transparent cluster moved')
})

test('a mirrored model writes its own rows again, its winding computed again', () => {
  const terrain = 900,
    model = 12
  const { rt, rows, moving } = scene(terrain, model)
  ;(moving.world.elements as Float64Array)[0] = -1
  assert.equal(moveRootRows(rt, moving, 0), model)
  assert.deepEqual(runsOf(rows.forEachDirtyRun), [[terrain, terrain + model - 1]])
  assert.equal(moving.windingEpoch, undefined)
})

test('a transparent model claims no row: its corners are sent again, no row is', () => {
  const { rt, rows, glass } = scene(4, 2)
  assert.equal(moveRootRows(rt, glass, 0), 0)
  assert.equal(rows.dirtyCount, 0)
  assert.equal(rt.blendState.occlusionEpoch, -1)
})

test('a mirrored blended model writes its shadow caster rows again, and those alone', () => {
  const { rt, rows, glass } = scene(4, 2, 2)
  // The glass casts from the rows behind the visibility rows, in reverse order.
  rows.setBlendRowOf(6, 7)
  rows.setBlendRowOf(7, 6)
  ;(glass.world.elements as Float64Array)[0] = -1
  assert.equal(moveRootRows(rt, glass, 0), 2)
  assert.deepEqual(runsOf(rows.forEachDirtyRun), [[6, 7]], 'the caster rows travel, no other')
})
