// The fields the host may write that no hook may touch — the node's own flags, a matrix set
// by hand, a light's numbers — are compared per frame to what was last read: a write is taken
// once, the same value read again is nothing, and the host's own walk writes nothing new.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../graph/graph.fixture.ts'
import { scan, snapshot, verdictOf, type WatchVerdict } from './scan.ts'
import { updateTransformTree } from '../../../../sdk-core/src/world/transform-tree/pass.ts'

function scene() {
  const parent = new G.Group()
  const mesh = G.mesh()
  parent.add(mesh)
  const light = G.spotLight(0xffffff, 1, 10, 0.5, 0.2, 2)
  const sky = G.lightProbe()
  return { parent, mesh, light, sky }
}

type Scene = ReturnType<typeof scene>
/** The scanned paths: each is taken with its verdict, and read again as-is is nothing. */
const WRITES: Array<{
  name: string
  node: keyof Scene
  write: (s: Scene) => void
  verdict?: WatchVerdict
}> = [
  { name: 'visible', node: 'mesh', write: ({ mesh }) => void (mesh.visible = false) },
  { name: 'castShadow', node: 'mesh', write: ({ mesh }) => void (mesh.castShadow = false) },
  {
    name: 'matrixAutoUpdate',
    node: 'mesh',
    write: ({ mesh }) => void (mesh.matrixAutoUpdate = false),
  },
  {
    name: 'reparenting',
    node: 'mesh',
    write: ({ mesh }) => void new G.Group().add(mesh),
    verdict: 'reshaped',
  },
  { name: 'light intensity', node: 'light', write: ({ light }) => void (light.intensity = 7) },
  {
    name: 'light range and cone',
    node: 'light',
    write: ({ light }) => void ((light.distance = 42), (light.angle = 0.1)),
  },
  {
    name: 'a light colour component',
    node: 'light',
    write: ({ light }) => void light.color.setRGB(0.25, 0.5, 0.75),
  },
  {
    name: 'a light colour replaced',
    node: 'light',
    write: ({ light }) => void Object.assign(light, { color: new G.Color(0xff0000) }),
  },
  {
    name: 'a probe colour component',
    node: 'sky',
    write: ({ sky }) => void (sky.color.g = 0.9),
  },
  {
    name: 'a light ground colour',
    node: 'light',
    write: ({ light }) => void light.groundColor.setRGB(0.1, 0.2, 0.3),
  },
]

for (const { name, node, write, verdict = 'moved' } of WRITES)
  test(`a write of ${name} is taken as ${verdict}, once`, () => {
    const s = scene()
    const state = snapshot(s[node])
    assert.equal(verdictOf(scan(state)), 0, 'nothing written since the snapshot')
    write(s)
    assert.equal(verdictOf(scan(state)), verdict)
    assert.equal(verdictOf(scan(state)), 0, 'read again, the value is the one held')
  })

test('a matrix set by hand on a frozen node, pushed by a forced walk, is taken once', () => {
  const { parent, mesh } = scene()
  mesh.matrixAutoUpdate = false
  const state = snapshot(mesh)
  mesh.matrix.makeTranslation(5, 0, 0)
  parent.updateMatrixWorld(true)
  assert.equal(mesh.matrixWorldNeedsUpdate, false, 'the forced walk never raised the flag')
  assert.equal(verdictOf(scan(state)), 'moved', 'the matrix is compared, not the flag')
  parent.updateMatrixWorld(true)
  assert.equal(verdictOf(scan(state)), 0, 'the same matrix walked again moves nothing')
})

test('updateMatrix() each tick on a frozen node, pose unchanged, is nothing', () => {
  const { mesh } = scene()
  mesh.position.x = 3
  mesh.updateMatrix()
  mesh.matrixAutoUpdate = false
  const state = snapshot(mesh)
  for (let tick = 0; tick < 5; tick++) mesh.updateMatrix()
  assert.equal(verdictOf(scan(state)), 0)
  mesh.position.x = 4
  mesh.updateMatrix()
  assert.equal(verdictOf(scan(state)), 'moved', 'a pose recomposed into a new matrix is seen')
})

test("the reference's own walk over automatic nodes is nothing: a still scene stays still", () => {
  const { parent, mesh, light } = scene()
  parent.add(light)
  const states = [parent, mesh, light].map(snapshot)
  for (let frame = 0; frame < 3; frame++) {
    parent.updateMatrixWorld(true)
    assert.deepEqual(
      states.map((state) => verdictOf(scan(state))),
      [0, 0, 0],
    )
  }
})

test('a frozen matrix scanned frame after frame lists nothing; a write kept behind the getter is taken', () => {
  const node = new G.Group()
  node.matrixAutoUpdate = false
  const kept = node.matrix,
    tree = G.Object3D._treeOf(node),
    state = snapshot(node)
  updateTransformTree(tree)
  for (let frame = 0; frame < 3; frame++) assert.equal(verdictOf(scan(state)), 0)
  assert.equal(updateTransformTree(tree), 0, 'reads walk nothing')
  kept.elements[12] = 3
  assert.equal(verdictOf(scan(state)), 'moved')
  assert.equal(updateTransformTree(tree), 1, 'the change found is walked')
  assert.equal(node.matrixWorld.elements[12], 3)
})
