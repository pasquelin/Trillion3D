// The occluder history follows the drawn view's fingerprint (`../../../frame/viewRevision.ts`): a
// still view keeps it, a moved view, projection or viewport lets every row leave the occluders
// again, and a motion a held image read stays owed to the next drawn one.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { invalidateOccluderHistory } from '../io/drops.ts'
import { createFrameGateCore } from '../../../frame/gateCore.ts'
import { engineCamera } from '../../../camera/camera.fixture.ts'
import { moveRootRows } from './movedRoot.ts'
import { createWebgpuRowState } from '../../row/state.ts'
import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'

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

// A moved model rewrites its own rows, not the scene's. The table's age must not advance on
// every move: that would write every row, every corner and every transparent corner again, and
// drop the whole scene's occlusion history, each image a model moved.
const ROW_WORDS = PAGE_INFO_STRIDE / 4

/** A root of `count` clusters, all placed by the same world. */
function root(name: string, count: number, transparent = false): ClusterRoot<PageRec> {
  const world = { elements: new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }
  const pages = Array.from(
    { length: count },
    (_, i) => ({ url: `${name}${i}`, transparent }) as unknown as PageRec,
  )
  return { world, pages, windingEpoch: 1 }
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
  const rows = createWebgpuRowState(pages, terrain + model, blendSlots)
  rows.pageTableFloats = new Float32Array(rows.casterSlots * ROW_WORDS)
  for (let row = 0; row < terrain + model; row++) {
    rows.rowOfPage[row] = row
    rows.packedPageIndex[row] = row
  }
  rows.packedCount = terrain + model
  const rt = { layout: { rows }, blendState: { occlusionEpoch: 1 } }
  return { rt, rows, moving, glass }
}

test('a model of N rows moved in a scene of M rows rewrites N rows', () => {
  const terrain = 900,
    model = 12
  const { rt, rows, moving } = scene(terrain, model)
  const before = rows.pageTableFloats!.slice()
  ;(moving.world.elements as Float64Array)[12] = 3
  assert.equal(moveRootRows(rt, moving), model)
  // The table travels for the model's rows alone, and keeps its age.
  assert.equal(rows.dirtyFrom, terrain)
  assert.equal(rows.dirtyTo, terrain + model - 1)
  assert.equal(rows.tableEpoch, 1)
  const after = rows.pageTableFloats!
  for (let row = 0; row < terrain + model; row++) {
    const base = row * ROW_WORDS,
      moved = row >= terrain
    assert.equal(after[base + 12], moved ? 3 : 0, `row ${row}: its world translation`)
    if (!moved)
      assert.deepEqual(
        after.subarray(base, base + ROW_WORDS),
        before.subarray(base, base + ROW_WORDS),
      )
  }
  // Their windings are computed again — their corners travel with their dirty rows.
  assert.equal(moving.windingEpoch, undefined)
  assert.equal(rt.blendState.occlusionEpoch, 1, 'no transparent cluster moved')
})

test('a transparent model claims no row: its corners are sent again, no row is', () => {
  const { rt, rows, glass } = scene(4, 2)
  assert.equal(moveRootRows(rt, glass), 0)
  assert.equal(rows.dirtyTo, -1)
  assert.equal(rt.blendState.occlusionEpoch, -1)
})

test('a moved blended model moves its shadow caster rows, and those alone', () => {
  const { rt, rows, glass } = scene(4, 2, 2)
  // The glass casts from the rows behind the visibility rows, in reverse order.
  rows.blendRowOf[6] = 7
  rows.blendRowOf[7] = 6
  ;(glass.world.elements as Float64Array)[12] = 5
  assert.equal(moveRootRows(rt, glass), 2)
  assert.deepEqual([rows.dirtyFrom, rows.dirtyTo], [6, 7], 'the caster rows travel, no other')
  for (let row = 0; row < rows.casterSlots; row++)
    assert.equal(rows.pageTableFloats![row * ROW_WORDS + 12], row >= 6 ? 5 : 0, `row ${row}`)
})
