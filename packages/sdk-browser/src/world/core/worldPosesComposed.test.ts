// A parent whose seated children a session composes on the GPU sends its world alone when it
// turns: no row is written, no range is sent, whatever the number of children.
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { NODE_WORLD_LAZY } from '../../../../sdk-core/src/world/transform-tree/transformTree.ts'
import { multiplyMatrix4 } from '../../../../math/src/matrix/matrix4.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import { createPlacementRows } from '../../placement/rows.ts'
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { createWorldPoses, type PoseComposer } from './worldPoses.ts'
import type { Seat } from './worldBatches.ts'
import { noModels } from './worldModels.fixture.ts'

const N = 12000

function galaxy(count = N) {
  const scene = object.group(),
    parent = object.group(),
    shape = geometry.box(1, 1, 1),
    rows = createPlacementRows(count),
    batch = { rows },
    seats = new Map<Mesh, Seat>()
  scene.add(parent)
  for (let i = 0; i < count; i++) {
    const mesh = object.mesh(shape)
    mesh.position.set(i % 100, 0, Math.floor(i / 100))
    mesh.rotation.set(i * 0.01, 0, 0)
    parent.add(mesh)
    seats.set(mesh, { batch, row: i } as unknown as Seat)
  }
  return { scene, parent, rows, seats }
}

test('turning a parent of 12 000 composed rows sends one matrix and writes no row', () => {
  const { scene, parent, rows, seats } = galaxy()
  const poses = createWorldPoses(),
    sent: number[][] = [],
    linked: { links: number; world: number[] }[] = []
  const composer: PoseComposer = {
    key: scene,
    epoch: 0,
    link: (_, world, links) => (
      linked.push({ links: links.length, world: Array.from(world) }),
      true
    ),
  }
  const send = (_: unknown, from: number, to: number) => void sent.push([from, to])
  poses.moved(parent)
  poses.apply(scene, seats, noModels(), send, composer)
  assert.deepEqual(sent, [[0, N - 1]], 'the first write is whole')
  assert.equal(linked.at(-1)!.links, N, 'and links every child')
  const before = rows.matrices.slice()
  parent.rotation.y = 0.7
  poses.moved(parent)
  poses.apply(scene, seats, noModels(), send, composer)
  assert.equal(sent.length, 1, 'no range is sent')
  assert.deepEqual(rows.matrices, before, 'no row is written')
  assert.deepEqual(linked.at(-1), { links: 0, world: [...parent.matrixWorld.elements] })
})

test('without a composer, turning the parent writes every row', () => {
  const { scene, parent, rows, seats } = galaxy()
  const poses = createWorldPoses(),
    sent: number[][] = []
  const send = (_: unknown, from: number, to: number) => void sent.push([from, to])
  poses.moved(parent)
  poses.apply(scene, seats, noModels(), send)
  parent.rotation.y = 0.7
  poses.moved(parent)
  poses.apply(scene, seats, noModels(), send)
  assert.deepEqual(sent, [
    [0, N - 1],
    [0, N - 1],
  ])
  const last = [...parent.children.at(-1)!.matrixWorld.elements]
  assert.deepEqual([...rows.matrices.subarray((N - 1) * 16, N * 16)], last)
})

test('a composed parent destroyed is unlinked once its seats move on, its world never read', () => {
  const { scene, parent, seats } = galaxy(4)
  const poses = createWorldPoses(),
    unlinked: object[] = []
  const composer: PoseComposer = {
    key: scene,
    epoch: 0,
    link: (node, _, links, whole) => (whole && !links.length && unlinked.push(node), true),
  }
  const apply = () => poses.apply(scene, seats, noModels(), () => {}, composer)
  poses.moved(parent)
  apply()
  parent.destroy()
  seats.clear()
  composer.epoch++
  apply()
  assert.deepEqual(unlinked, [parent], 'unlinked, the session holds none of its rows')
  apply()
  assert.equal(unlinked.length, 1, 'and forgotten')
})

test('the children a session composes are not walked by the transform pass, and read as eager ones do', () => {
  const { scene, parent, seats } = galaxy(2000)
  const tree = Object3D._treeOf(scene)
  const poses = createWorldPoses()
  const composer: PoseComposer = { key: scene, epoch: 0, link: () => true }
  const apply = () => poses.apply(scene, seats, noModels(), () => {}, composer)
  poses.moved(parent)
  apply()
  const children = [...parent.children]
  assert.ok(
    children.every((child) => tree.flags[child.index] & NODE_WORLD_LAZY),
    'every composed child is lazy',
  )
  const versions = children.map((child) => tree.version[child.index])
  parent.rotation.y = 0.7
  parent.position.set(3, 1, -2)
  poses.moved(parent)
  apply()
  assert.deepEqual(
    children.map((child) => tree.version[child.index]),
    versions,
    'no child recalculated by the pass',
  )
  const expected = new Float64Array(16)
  for (const child of [children[0], children[1234], children.at(-1)!]) {
    multiplyMatrix4(expected, parent.matrixWorld.elements, child.matrix.elements)
    assert.deepEqual([...child.matrixWorld.elements], [...expected], 'read, it is the composition')
  }
})

test('children a session composes no more are the transform pass’s again, their world as it was read', () => {
  const { scene, parent, seats } = galaxy(8)
  const tree = Object3D._treeOf(scene)
  const poses = createWorldPoses()
  const composer: PoseComposer = { key: scene, epoch: 0, link: () => {} }
  const apply = () => poses.apply(scene, seats, noModels(), () => {}, composer)
  poses.moved(parent)
  apply()
  const child = parent.children[3]
  assert.ok(tree.flags[child.index] & NODE_WORLD_LAZY)
  parent.rotation.y = 0.3
  poses.moved(parent)
  apply()
  const read = [...child.matrixWorld.elements]
  poses.apply(scene, seats, noModels(), () => {}, undefined) // no session composes any more
  assert.equal(tree.flags[child.index] & NODE_WORLD_LAZY, 0, 'no longer lazy')
  assert.deepEqual([...child.matrixWorld.elements], read, 'its world is the one it had')
})
