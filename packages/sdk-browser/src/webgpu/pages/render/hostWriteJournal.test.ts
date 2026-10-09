// What the host writes reaches the engine whatever else the task does: a hide or a matrix written
// with a light set in the same task, or a flip and a matrix in one image, each followed; a light set
// through the engine reads no source graph; the journal of field writes a ring a reader follows
// without ever rescanning everything, and a write made while it is read is read next. On generated
// scenes of 10³ and 10⁵ meshes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { countScans, hostScene as scene, withLightStore } from './hostWrite.fixture.ts'
import { refreshSceneLights } from '../io/hostApi.ts'
import {
  nodeWrites,
  nodesWrittenSince,
  noteNodeWrite,
} from '../../../../../sdk-core/src/scene/core/nodeEdits.ts'
import * as G from '../../../host/graph/graph.fixture.ts'

test('a hide and a light set in one task: the root hidden is parked', () => {
  const { meshes, rt, parks, image } = scene(100)
  withLightStore(rt)
  parks.length = 0
  meshes[3].visible = false
  refreshSceneLights(rt)
  image()
  assert.deepEqual(parks, [3])
})

test('a light set an image reads no source graph, at 10³ as at 10⁵ roots', () => {
  for (const count of [1e3, 1e5]) {
    const { source, rt, image } = scene(count)
    withLightStore(rt)
    let walks = 0
    const traverse = source.traverse.bind(source)
    source.traverse = (visit) => (walks++, traverse(visit))
    for (let frame = 0; frame < 4; frame++) {
      refreshSceneLights(rt)
      image()
    }
    assert.equal(walks, 0, `${count} roots`)
  }
})

test('a frozen node shown again with a new matrix in one image is drawn at its new world', () => {
  const { meshes, rt, image } = scene(50)
  const node = meshes[6]
  node.visible = false
  node.matrixAutoUpdate = false
  image()
  node.matrix.elements[12] = 40
  node.matrixWorldNeedsUpdate = true
  node.visible = true
  image()
  assert.equal(rt.timing.worldCounts.rootsUploaded, 1, 'its root named and sent')
  assert.equal(rt.layout.selectionRoots[6].world.elements[12], 40)
})

test('a hundred hides an image over a hundred images scan the same nodes at 10³ and 10⁵', () => {
  const scans = [1e3, 1e5].map((count) => {
    const { meshes, image } = scene(count)
    const reads = countScans(meshes)
    const before = reads()
    for (let frame = 0; frame < 100; frame++) {
      for (let k = 0; k < 100; k++) meshes[k].visible = frame % 2 === 1
      image()
    }
    return reads() - before
  })
  assert.equal(scans[0], scans[1], `${scans[0]} reads against ${scans[1]}`)
})

test('a write made while the journal is read is read next, nothing dropped', () => {
  const node = new G.Object3D(),
    other = new G.Object3D(),
    late = new G.Object3D()
  // Bring the journal to one write short of its end, then two writes across it.
  while (nodeWrites() % 4096 !== 4095) noteNodeWrite(node)
  const from = nodeWrites()
  noteNodeWrite(node)
  noteNodeWrite(other)
  const seen: number[] = []
  const whole = nodesWrittenSince(from, (slot) => {
    seen.push(slot)
    if (seen.length === 1) noteNodeWrite(late)
  })
  assert.equal(whole, true)
  assert.deepEqual(seen, [node.index, other.index], 'the two written before the read')
  const next: number[] = []
  nodesWrittenSince(from + 2, (slot) => next.push(slot))
  assert.deepEqual(next, [late.index], 'the one written during it, read next')
})

test('a light out of a world names itself: its colour written scans it alone', () => {
  const scans = [1e3, 1e5].map((count) => {
    const { source, meshes, run, image } = scene(count)
    const lamp = G.pointLight()
    source.add(lamp)
    // A light the host adds is a reshape the engine announces: the watch reads the list anew.
    run.gate.sceneChanged()
    image()
    const reads = countScans([...meshes, lamp])
    const before = reads()
    for (let frame = 0; frame < 4; frame++) {
      lamp.color.setRGB(frame / 4, 0, 0)
      image()
    }
    return reads() - before
  })
  assert.equal(scans[0], scans[1], `${scans[0]} reads against ${scans[1]}`)
})
