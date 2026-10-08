// What a host write names is the engine's own record of it, never a list the page shares: a pose
// written then a pass of the page's tree someone else ran is still named; a hide reaches every root
// under the node hidden, those a growth added in place included, and the see-through draws under it
// alone; a slot freed and taken by another node names nothing of the old; a reshape the engine owes
// is walked even when an engine move follows it in the same task. On generated scenes.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { selectionRoot } from '../../core/transformShear.fixture.ts'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { updateTransformTree } from '../../../../../sdk-core/src/world/transform-tree/pass.ts'
import { hostScene as scene } from './hostWrite.fixture.ts'
import { setWebgpuTransform } from './transform.ts'
import { appendRootsUnder } from './movedNode.ts'

test('a pose written, then a pass of the page’s tree another reader ran: the root is named', () => {
  const { source, meshes, rt, sent, image } = scene(100)
  meshes[7].position.x += 1
  updateTransformTree(Object3D._treeOf(source))
  sent.length = 0
  image()
  assert.deepEqual([rt.timing.worldCounts.rootsUploaded, ...sent], [1, 1])
})

test('a hide reaches every root under the node, one a growth added in place included', () => {
  const { holder, roots, worlds, parks, image } = scene(50)
  const grown = G.mesh(roots[0].pages[0].sourceMesh!.geometry as never)
  holder.add(grown)
  roots.push(selectionRoot(grown, [-1, -1, -1, 1, 1, 1], worlds))
  image()
  parks.length = 0
  holder.visible = false
  image()
  assert.deepEqual(
    parks.sort((a, b) => a - b),
    Array.from({ length: 51 }, (_, k) => k),
  )
})

test('a slot freed and taken by another node names nothing of the old node’s root', () => {
  const { holder, meshes, roots } = scene(20)
  const gone = meshes[4]
  // The roots' index is built before the node goes, as a session holds it.
  const named: number[] = []
  assert.equal(appendRootsUnder(roots, gone, named, 0), 1)
  assert.deepEqual(named, [4], 'its root')
  gone.destroy()
  const other = new G.Group()
  holder.add(other)
  assert.equal(other.index, gone.index, 'the slot taken again')
  assert.equal(appendRootsUnder(roots, other, [], 0), 0, 'none of the old root')
})

test('a hide reads the see-through draws under the node alone, at 10² as at 10⁴', () => {
  const reads = [1e2, 1e4].map((count) => {
    const { meshes, blendGpu, image } = scene(count, true)
    let read = 0
    for (const item of blendGpu) {
      const mesh = item.sourceMesh
      Object.defineProperty(item, 'sourceMesh', { get: () => (read++, mesh) })
    }
    // The first flip builds the draws' index once; the next reads those under its node alone.
    meshes[3].visible = false
    image()
    const built = read
    meshes[5].visible = false
    image()
    return read - built
  })
  assert.equal(reads[0], reads[1], `${reads[0]} reads against ${reads[1]}`)
})

test('a reshape the engine owes is walked, an engine move after it in the same task or not', () => {
  const { meshes, rt, run, sent, image } = scene(30)
  sent.length = 0
  run.gate.sceneChanged()
  setWebgpuTransform(
    rt,
    meshes[2].name,
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1]),
  )
  image()
  assert.equal(rt.timing.worldCounts.rootsUploaded, 30, 'every root walked')
})
