// A model's rows follow its world on the GPU once the session composes them: the first walk that
// moves it writes its rows whole and links them to the model's world, each at its mesh's own in
// the graph; the next moves of the model send its world alone, no row written. A graph node that
// moves, or the model shown or hidden, writes the rows whole again; a model written outside a
// walk is unlinked and linked anew at the next.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { modelNode } from './modelNodes.ts'
import { createWorldModels } from './worldModels.ts'
import { createWorldRanks } from './worldRanks.ts'
import { createWorldPoses, type PoseComposer } from './worldPoses.ts'
import { loadedModel } from './worldModels.fixture.ts'

function rig() {
  const models = createWorldModels(createWorldRanks()),
    { loaded, drawn } = loadedModel([{ meshes: 0 }, { meshes: 1 }])
  const scene = new Object3D()
  scene.add(loaded)
  scene.updateMatrixWorld(true)
  const draws = models.drawsOf(loaded)
  const poses = createWorldPoses(),
    sent: unknown[][] = [],
    links: { links: number; whole: boolean; world: number[]; locals: number[][] }[] = []
  const composer: PoseComposer = {
    key: scene,
    epoch: 0,
    link: (parent, world, given, whole) => {
      if (parent === loaded)
        links.push({
          links: given.length,
          whole,
          world: Array.from(world),
          locals: given.map((link) => Array.from(link.local)),
        })
    },
  }
  const frame = () =>
    poses.apply(
      scene,
      new Map(),
      models,
      (rows, from, to) => void sent.push([rows, from, to]),
      composer,
    )
  return {
    loaded,
    drawn,
    draws,
    poses,
    sent,
    links,
    frame,
    models,
    composer,
  }
}

test('the first move writes the rows and links them, the next moves send the model’s world alone', () => {
  const { loaded, draws, poses, sent, links, frame } = rig()
  loaded.position.set(1, 0, 0)
  poses.moved(loaded)
  frame()
  assert.equal(sent.length, 2, 'the rows written, one range each')
  assert.deepEqual(
    links.map(({ links: count, whole }) => [count, whole]),
    [[2, true]],
    'both rows linked under the model',
  )
  const written = draws.rowed.map((source) => source.rows.matrices.slice())
  loaded.position.set(4, 0, 2)
  poses.moved(loaded)
  frame()
  assert.deepEqual(
    links.slice(1).map(({ links: count, whole }) => [count, whole]),
    [[0, false]],
    'its world alone',
  )
  assert.equal(sent.length, 2, 'no range sent')
  assert.deepEqual(
    draws.rowed.map((source) => source.rows.matrices),
    written,
    'no row written',
  )
  assert.deepEqual(links.at(-1)!.world.slice(12, 15), [4, 0, 2])
})

test('a node of the graph that moves, or the model hidden, writes the rows whole and links them again', () => {
  const { loaded, drawn, draws, poses, links, frame } = rig()
  loaded.position.set(1, 0, 0)
  poses.moved(loaded)
  frame()
  // A node the page looked up stands for a graph node: its move is written into the graph.
  const node = modelNode(drawn[0])
  loaded.add(node)
  node.position.set(0, 3, 0)
  poses.moved(node)
  frame()
  assert.deepEqual(
    links.map(({ whole }) => whole),
    [true, true],
    'a node moved: whole',
  )
  // The session composes the rows: no matrix is written, the link carries the mesh's world in the
  // graph as it stands — the node moved.
  assert.deepEqual(links.at(-1)!.locals[0].slice(12, 15), [0, 3, 0])
  assert.deepEqual([...draws.rowed[0].rows.matrices.slice(12, 15)], [0, 0, 0], 'none written')
  loaded.visible = false
  poses.moved(loaded)
  frame()
  assert.equal(links.length, 3)
  assert.deepEqual([draws.rowed[0].rows.live[0], draws.rowed[1].rows.live[0]], [0, 0])
})

test('a model written outside a walk is written whole at the next, its rows linked again', () => {
  const { loaded, models, poses, sent, links, frame } = rig()
  loaded.position.set(1, 0, 0)
  poses.moved(loaded)
  frame()
  const before = sent.length
  poses.writeModel(models, loaded, true)
  frame()
  assert.deepEqual(
    links.map(({ whole }) => whole),
    [true, true],
    'linked again, whole: the link it held stands no more',
  )
  assert.ok(sent.length > before, 'its rows were sent')
})
