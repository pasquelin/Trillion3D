import '../../../wasm/sdkWasm.fixture.ts'
import { HALF_PI } from '../../../../../math/src/constants.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { LoadedModel, type ModelRecord } from './loadedModel.ts'
import { createWorldPoses } from '../poses/poses.ts'
import { Scene } from '../scene.ts'
import { noModels } from './models.fixture.ts'

/** A compiled model's graph as its loader builds it: a root, a turbine and its rotor, and a
 *  crane nobody looks up. */
function compiledModel() {
  const root = new Object3D(),
    turbine = new Object3D(),
    rotor = new Object3D(),
    crane = new Object3D()
  root.name = 'Scene'
  turbine.name = 'turbine'
  turbine.position.set(10, 0, 0)
  rotor.name = 'rotor'
  rotor.position.set(0, 5, 0)
  crane.name = 'crane'
  root.add(turbine, crane)
  turbine.add(rotor)
  const record = {
    scene: { source: root, nodes: [turbine, rotor, crane] },
  } as unknown as ModelRecord
  return { model: new LoadedModel(record), turbine, rotor }
}

/** Every scene node under `node`, itself left out. */
function countBelow(node: Object3D) {
  let count = -1
  node.traverse(() => count++)
  return count
}

test('a compiled model builds no scene node until one is looked up, then only its chain', () => {
  const { model } = compiledModel()
  assert.equal(countBelow(model), 0, 'loading allocates nothing per graph node')
  const scene = new Object3D()
  scene.add(model)
  const rotor = scene.getObjectByName('rotor')!
  assert.equal(countBelow(model), 3, 'the root, the turbine and the rotor; the crane is left')
  assert.equal(scene.getObjectByName('rotor'), rotor, 'a second lookup finds the same node')
  assert.equal(countBelow(model), 3)
  assert.equal(model.getObjectByName('missing'), undefined)
})

test('every named node of a compiled model is found by name, posed as its graph node', () => {
  const { model, turbine, rotor } = compiledModel()
  for (const graph of [turbine, rotor]) {
    const node = model.getObjectByName(graph.name)!
    assert.ok(node, `${graph.name} is reachable`)
    assert.deepEqual(node.position.toArray(), [graph.position.x, graph.position.y, 0])
  }
  assert.equal(model.getObjectByName('rotor')!.parent, model.getObjectByName('turbine'))
})

test('moving a node of a compiled model moves the graph node it is drawn from', () => {
  const { model, turbine, rotor } = compiledModel()
  const scene = new Object3D()
  scene.add(model)
  const poses = createWorldPoses()
  const node = model.getObjectByName('rotor')!
  node.rotation.set(0, 0, HALF_PI)
  node.visible = false
  poses.moved(node)
  poses.apply(scene, new Map(), noModels(), () => {})
  assert.equal(rotor.position.y, 5, 'the local pose is kept')
  assert.ok(Math.abs(rotor.quaternion.z - Math.SQRT1_2) < 1e-12, 'the turn reached the graph')
  assert.equal(rotor.visible, false, 'and so did the visibility')
  assert.deepEqual([turbine.position.x, turbine.quaternion.z], [10, 0], 'its parent is left')
})

test('a node whose matrix is its pose is read from and written to its matrix', () => {
  const { model, rotor } = compiledModel()
  rotor.position.set(0, 0, 0)
  rotor.matrix.makeTranslation(0, 7, 0)
  rotor.matrixAutoUpdate = false
  const node = model.getObjectByName('rotor')!
  assert.equal(node.position.y, 7, 'the pose comes from the matrix')
  node.position.x = 2
  const poses = createWorldPoses()
  poses.moved(node)
  poses.apply(model, new Map(), noModels(), () => {})
  assert.deepEqual([rotor.matrix.elements[12], rotor.matrix.elements[13]], [2, 7])
})

test('the graph the file carried is left out of a saved scene, its subtree with it', () => {
  const { model } = compiledModel()
  model.getObjectByName('rotor')
  assert.equal(model._fromFile(model.getObjectByName('Scene')!), true)
})

test('a loaded model and a scene root refuse to be cloned, by name', () => {
  const refused = { name: 'EngineError', code: 'UNSUPPORTED_SCENE_UPDATE' }
  assert.throws(() => compiledModel().model.clone(), refused)
  assert.throws(() => new Scene(() => Promise.reject(new Error('no load'))).clone(), refused)
})

test('a source node is reached by its index, with the indices below it; none while unnumbered', () => {
  const { model } = compiledModel()
  const found = model._nodeAt(0)!
  assert.equal(found.node, model.getObjectByName('turbine'), 'the node a name finds')
  assert.deepEqual([found.indices, found.radius], [[0, 1], 0], 'its rotor below; nothing drawn')
  assert.equal(model._nodeAt(7), null)
  // Was: a partitioned cache gave no nodes at all. Its nodes now come by source rank, a hole
  // where a cell places one in the core's stead: the others are still found, the hole is not.
  const scene = model.record.scene as { nodes: Object3D[] | null }
  const holed = [...scene.nodes!]
  delete holed[2]
  scene.nodes = holed
  assert.equal(model._nodeAt(2), null, 'a node a cell places has no node of its own')
  assert.deepEqual(model._nodeAt(0)!.indices, [0, 1], 'beside a hole, the subtree still read')
  scene.nodes = null
  assert.equal(model._nodeAt(0), null, 'a replicated scene numbers its nodes otherwise')
})

test('the cells of a model hold a node while no cell draws it, or one has placed it', () => {
  const { model, turbine, rotor } = compiledModel()
  const scene = model.record.scene as unknown as {
    nodes: Object3D[]
    streams: Set<number>
    partitions: object[]
  }
  const alone = compiledModel().model
  ;(alone.record.scene as unknown as { partitions: object[] }).partitions = []
  assert.equal(alone._cells(), null, 'no cell draws a model with no partition')
  // The partition draws source node 1 from the rotor the core keeps for its row (`streams`), and
  // node 2, the crane, in the core's stead: no core node.
  let moves = 0
  const placed = new Set<number>()
  const draws = {
    drawn: (node: number) => placed.has(node),
    get changes() {
      return moves
    },
  }
  scene.partitions = [{ draws }]
  scene.streams = new Set([1])
  delete scene.nodes[2]
  assert.equal(model._graphNodeAt(0), turbine)
  assert.equal(model._graphNodeAt(1), rotor)
  assert.equal(model._graphNodeAt(2), null, 'a node a cell places has no graph node')
  const cells = model._cells()!
  assert.equal(model._cells(), cells, 'one reading')
  const held = () => [0, 1, 2, 9].map(cells.holds)
  assert.deepEqual(held(), [true, false, false, false], 'node 0, the core’s, is held')
  placed.add(1)
  placed.add(9)
  moves++
  assert.deepEqual([held(), cells.changes], [[true, true, false, true], 1])
})
