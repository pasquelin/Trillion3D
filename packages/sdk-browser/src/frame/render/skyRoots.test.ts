import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneHasSkyMaterial, skyNodes, skyOpen, viewSky } from './skyRoots.ts'
import { createViewHidden } from './viewHidden.ts'
import { NO_VIEW_SET, type ViewSet } from '../../../../sdk-core/src/world/camera/viewSet.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

type Root = {
  worn: { surface: { sky?: boolean } }
  pages: { drawSource: { node: Object3D } }[]
  hidden?: boolean
  parked?: boolean
}
const box = () => object.mesh(geometry.box(1, 1, 1))
const root = (sky: boolean, node: Object3D): Root => ({
  worn: { surface: { sky } },
  pages: [{ drawSource: { node } }],
})
const runtime = (roots: Root[]) => {
  const rt = {
    layout: { selectionRoots: roots, rootIndex: { revision: 0 }, viewHidden: createViewHidden() },
    run: { gate: { revisions: { scene: 0 } } },
    context: {},
    gpu: {} as { viewKey?: object },
    vis: {},
    blendState: { skyItems: [] as { drawSource?: { node?: Object3D } }[] },
  }
  return rt
}
const real = (rt: ReturnType<typeof runtime>) => rt as unknown as WebgpuPagesRuntime
/** What a view of the main camera, with no list, sees. */
const seen = (rt: ReturnType<typeof runtime>, set: ViewSet = NO_VIEW_SET) =>
  sceneHasSkyMaterial(real(rt), set, true)

test('the sky nodes are the nodes of the roots wearing a sky material, each once', () => {
  const [dome, ground] = [box(), box()]
  const rt = runtime([root(true, dome), root(false, ground), root(true, dome)])
  assert.deepEqual(skyNodes(real(rt)), [dome])
  assert.equal(seen(rt), true)
})

test('a scene with no sky material has none, one that gains a root lists it; the same list stands until the scene moves', () => {
  const rt = runtime([root(false, box())])
  assert.equal(seen(rt), false)
  const dome = box()
  rt.layout.selectionRoots.push(root(true, dome))
  const nodes = skyNodes(real(rt))
  assert.deepEqual(nodes, [dome])
  assert.equal(skyNodes(real(rt)), nodes, 'the same array until the scene moves')
})

test('a sky root the host hides or parks is not drawn: the scene then has no sky material', () => {
  const dome = root(true, box())
  const rt = runtime([dome])
  assert.equal(seen(rt), true)
  dome.hidden = true
  rt.run.gate.revisions.scene++
  assert.equal(seen(rt), false)
})

test('a view that hides the dome, or shows other objects only, has no sky material while another view has', () => {
  const [dome, ground] = [box(), box()]
  const rt = runtime([root(true, dome), root(false, ground)])
  const hiding: ViewSet = { ...NO_VIEW_SET, hidden: [dome] }
  const showing: ViewSet = { ...NO_VIEW_SET, showOnly: [ground] }
  const showingDome: ViewSet = { ...NO_VIEW_SET, showOnly: [dome] }
  assert.equal(seen(rt, hiding), false, 'hidden from the view')
  assert.equal(seen(rt, showing), false, 'not among the only objects the view shows')
  assert.equal(seen(rt, showingDome), true)
  assert.equal(seen(rt), true, 'the view with no list')
})

test('a sky surface of the plan that no node stands for opens the scene: it has a sky material for every view and the capture is cut to no list', () => {
  const dome = box()
  const rt = runtime([root(false, box())])
  assert.equal(skyOpen(real(rt)), false)
  assert.equal(seen(rt), false)
  // An actor of an HLOD cell, or the world DAG's: a sky surface of the plan with no node.
  rt.blendState.skyItems = [{ drawSource: { node: dome } }, {}]
  assert.equal(skyOpen(real(rt)), true)
  assert.equal(seen(rt, { ...NO_VIEW_SET, hidden: [dome] }), true)
  // A list of surfaces each with a node, as the records make it again, closes it.
  rt.blendState.skyItems = [{ drawSource: { node: dome } }]
  assert.equal(skyOpen(real(rt)), false)
})

test('a node-less sky surface is drawn by a view that names no object to show only, and not by one that does', () => {
  const [dome, ground] = [box(), box()]
  const rt = runtime([root(true, dome), root(false, ground)])
  const actor = {}
  const plain = { drawSource: { node: dome } }
  rt.blendState.skyItems = [plain, actor]
  const itemsOf = (set: ViewSet) => viewSky(real(rt), set, true).items
  assert.deepEqual([...itemsOf(NO_VIEW_SET)], [plain, actor])
  const showingGround: ViewSet = { ...NO_VIEW_SET, showOnly: [ground] }
  assert.equal(
    itemsOf(showingGround).size,
    0,
    'no sky object shown, and the actor is not among the objects named',
  )
  assert.equal(sceneHasSkyMaterial(real(rt), showingGround, true), false)
  assert.deepEqual([...itemsOf({ ...NO_VIEW_SET, hidden: [dome] })], [actor])
})

test('each view keeps its own answer: two views taking turns do not evict one another', () => {
  const [dome, ground] = [box(), box()]
  const rt = runtime([root(true, dome), root(false, ground)])
  const plain = { drawSource: { node: dome } }
  rt.blendState.skyItems = [plain]
  const hiding: ViewSet = { ...NO_VIEW_SET, hidden: [dome] }
  const main = viewSky(real(rt), NO_VIEW_SET, true)
  const mainGpu = rt.gpu
  rt.gpu = {}
  const face = viewSky(real(rt), hiding, false)
  assert.equal(face.items.size, 0)
  rt.gpu = mainGpu
  assert.equal(
    viewSky(real(rt), NO_VIEW_SET, true),
    main,
    'the main view finds its answer as it left it',
  )
  assert.equal(main.items.size, 1)
  assert.equal(viewSky(real(rt), NO_VIEW_SET, true).items, main.items, 'the set stands by identity')
})

test('a sky root hidden or parked without a scene revision (streaming) is seen at once', () => {
  const dome = root(true, box())
  const rt = runtime([dome])
  assert.equal(seen(rt), true)
  dome.parked = true
  assert.equal(seen(rt), false, 'parked by a row, the scene revision unchanged')
  dome.parked = false
  assert.equal(seen(rt), true)
})
