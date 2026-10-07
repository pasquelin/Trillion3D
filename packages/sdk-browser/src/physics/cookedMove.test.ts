import test from 'node:test'
import assert from 'node:assert/strict'
import { MOTION, OP, type CookedBody } from '../../../sdk-core/src/physics/index.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { createCookedBodies } from './cookedBodies.ts'
import { followMove } from './nodePose.ts'
import { createPosePlacer } from './placer.ts'
import { createPhysicsPoses } from './poses.ts'
import { moversOf } from './tilePlace.ts'
import {
  cooked,
  landed,
  modelStreamer,
  place,
  sharedShapes,
  streamedModel,
  tile,
} from './tiles.fixture.ts'
import { poseRecord } from './worker.fixture.ts'

/** Where the moving bodies of `bodies` want ground (`moversOf`), over a list it reused: its
 *  front alone. */
const moversIn = (bodies: ReturnType<typeof modelStreamer>['bodies']) => {
  const out = [9, 9, 9, 9, 9, 9, 9, 9]
  return out.slice(0, moversOf(bodies.meshes, bodies.nested, bodies.state.velocity, out))
}
/** Node 0's dynamic crate, two metres up, and node 1 kinematic, each placed by its own tile. */
const crate = {
  ...{ node: 0, motion: { mass: 5 }, shape: { type: 'box', box: { size: [1, 1, 1] } } },
  ...{ position: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
} as CookedBody
const lift = {
  ...crate,
  node: 1,
  motion: { isKinematic: true },
  position: [10, 0, 0],
} as CookedBody
const collider = { tiles: [tile()], material: null }
const file = { ...cooked([collider, collider], [place(0), place(1)]), bodies: [crate, lift] }
const close = (a: ArrayLike<number>, b: number[]) => b.every((v, i) => Math.abs(a[i] - v) < 1e-6)

test('a declared dynamic body simulates, and its compiled node is drawn where it is simulated', async () => {
  const streamed = await streamedModel(file, new Uint8Array(4), {}, 1, [crate, lift])
  const { tiles, scene, model, writer, bodies, errors } = streamed
  const [node, still] = model.children
  tiles.update([0, 0, 0], 1000)
  await landed()
  const words = writer.take()
  assert.deepEqual(errors, [])
  assert.deepEqual([words[0], words[2], words[5]], [OP.add, MOTION.dynamic, 0], 'dynamic, awake')
  assert.equal(bodies.count.bodies, 2, 'the two bodies, neither node’s tile doubling them')
  const id = words[1]
  // Its model moved: the body is put where its node is now drawn.
  model.position.set(1, 0, 0)
  model.updateMatrixWorld(true)
  tiles.moved(model)
  const moved = writer.take()
  assert.deepEqual([moved[0], ...new Float32Array(moved.buffer, 8, 3)], [OP.teleport, 1, 2, 0])
  // A tick: its node is drawn at the simulated pose, local to its model; the other one stays.
  const poses = createPhysicsPoses(8, scene)
  const posed = { ...bodies, retire() {} }
  const half = Math.SQRT1_2
  poses.receive(poseRecord(id, [1, 0.5, 0, 0, half, 0, half]), 1, posed, 0)
  poses.apply(posed, 1, false)
  assert.ok(close(node.position.elements, [0, 0.5, 0]), `${node.position.toArray()}`)
  assert.ok(close(node.quaternion.elements, [0, half, 0, half]), 'turned as simulated')
  assert.ok(close(node.scale.elements, [1, 1, 1]), 'its scale kept')
  node.updateWorldMatrix(true, false)
  assert.ok(close(node.matrixWorld.elements.slice(12), [1, 0.5, 0]), 'drawn where simulated')
  assert.ok(close(still.position.elements, [10, 0, 0]), 'the kinematic node left alone')
  // It wants ground around it as any mover: its radius, at its drawn place.
  assert.deepEqual(moversIn(bodies), [1, 0.5, 0, 1])
})

test('a model with no dynamic body moves no node and wants no ground for one', async () => {
  const alone = { ...file, bodies: [lift] }
  const { tiles, bodies, writer } = await streamedModel(alone, new Uint8Array(4), {}, 1, [lift])
  tiles.update([0, 0, 0], 1000)
  await landed()
  const words = writer.take()
  assert.deepEqual([words[0], words[2]], [OP.add, MOTION.kinematic])
  assert.equal(bodies.nested.size, 0, 'no node moved by the physics')
  assert.deepEqual(moversIn(bodies), [])
})

test('a model moved before its body’s tick is drawn carries its node, never back where it was', async () => {
  const streamed = await streamedModel(file, new Uint8Array(4), {}, 1, [crate, lift])
  const { tiles, scene, model, writer, bodies } = streamed
  const [node] = model.children
  tiles.update([0, 0, 0], 1000)
  await landed()
  const id = writer.take()[1]
  const poses = createPhysicsPoses(8, scene)
  const posed = { ...bodies, retire() {} }
  poses.receive(poseRecord(id, [0, 1, 0, 0, 0, 0, 1]), 1, posed, 0)
  // The page moves the model (`session.pose`): its body is put where the node now stands.
  model.position.set(3, 0, 0)
  model.updateMatrixWorld(true)
  tiles.moved(model)
  poses.follow(model)
  poses.apply(posed, 1, false)
  assert.ok(close(node.position.elements, [0, 2, 0]), `${node.position.toArray()}`)
  node.updateWorldMatrix(true, false)
  assert.ok(close(node.matrixWorld.elements.slice(12), [3, 2, 0]), 'carried by its model')
})

test('a page moving a compiled node puts its body there, not back where its last tick left it', async () => {
  const streamed = await streamedModel(file, new Uint8Array(4), {}, 1, [crate, lift])
  const { tiles, model, writer, bodies } = streamed
  const [node] = model.children
  tiles.update([0, 0, 0], 1000)
  await landed()
  writer.take()
  const followed: Object3D[] = []
  node.position.set(0, 5, 0)
  followMove(node, bodies.nested, writer, (moved) => followed.push(moved))
  const words = writer.take()
  assert.deepEqual([words[0], ...new Float32Array(words.buffer, 8, 3)], [OP.teleport, 0, 5, 0])
  assert.deepEqual(followed, [node], 'drawn from where it stands')
  followMove(new Object3D(), bodies.nested, writer, () => {})
  assert.equal(writer.take().length, 0, 'a node elsewhere moves no body')
})

test('a body inside a dynamic body’s subtree keeps its node’s tile out when that body leaves', async () => {
  const inner = { ...lift, node: 2 }
  const { model, writer, bodies } = modelStreamer({}, 1, [crate, inner])
  const [top] = model.children
  model._nodeAt = (i: number) => (i === 0 ? { node: top, indices: [0, 2], radius: 1 } : null)
  const rigid = createCookedBodies(
    writer,
    bodies,
    sharedShapes(writer, bodies),
    () => {},
    assert.fail,
  )
  rigid.open(model, [crate, inner], new AbortController().signal)
  await landed()
  const holds = () => [0, 1, 2].map((node) => rigid.holds(model, node))
  assert.deepEqual(holds(), [true, false, true], 'the dynamic subtree and the inner node')
  const owners = Array.from({ length: 8 }, (_, slot) => bodies.slots.at(slot))
  const falling = owners.find((owner) => owner && 'body' in owner && owner.body.moves)
  rigid.refused(falling as Parameters<typeof rigid.refused>[0])
  assert.deepEqual(holds(), [false, false, true], 'the inner body still stands for its node')
})

test('nested nodes are posed parents first, whatever order their slots are written in', () => {
  const root = new Object3D(),
    parent = new Object3D(),
    child = new Object3D()
  root.add(parent)
  parent.add(child)
  child.position.set(0, 1, 0)
  root.updateMatrixWorld(true)
  const placer = createPosePlacer(4, root)
  placer.bindNode(1, 0, parent, [1, 1, 1])
  placer.bindNode(0, 0, child, [1, 1, 1])
  placer.position.set([5, 1, 0], 0)
  placer.position.set([5, 0, 0], 3)
  placer.begin()
  placer.commit(Int32Array.of(0, 1), 2)
  placer.end()
  assert.ok(close(child.position.elements, [0, 1, 0]), `${child.position.toArray()}`)
  assert.ok(close(parent.position.elements, [5, 0, 0]))
})
