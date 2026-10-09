// The journal of field writes holds what the host wrote whatever the read it is in does: frozen
// nodes on storage of their own, thousands written in one image, each follow; a hide behind a
// backlog of a ring less one is kept; the engine's own pose is not read back as a host write; and
// each node moved costs one entry, so thousands moved an image read the nodes moved alone. On
// generated scenes of 10² to 10⁵ meshes.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { countScans, hostScene as scene } from './hostWrite.fixture.ts'
import { setWebgpuTransforms } from './transform.ts'
import { noteNodeWrite } from '../../../../../sdk-core/src/scene/core/nodeEdits.ts'
import { copyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'

/** Each of `meshes` frozen on storage of its own, its first image read; the storages. */
function frozenOnOwn(meshes: readonly G.Object3D[], image: () => void) {
  const storages = meshes.map((mesh) => {
    mesh.matrixAutoUpdate = false
    const own = Float64Array.from(mesh.matrix.elements)
    mesh.matrix.elements = own
    return own
  })
  image()
  return storages
}

test('three thousand frozen nodes on storage of their own written in one image all follow', () => {
  const { meshes, roots, image } = scene(3000)
  const storages = frozenOnOwn(meshes, image)
  storages.forEach((own, k) => (own[12] = 100 + k))
  for (const mesh of meshes) mesh.matrixWorldNeedsUpdate = true
  image()
  const stale = roots.filter((root, k) => root.world.elements[12] !== 100 + k).length
  assert.equal(stale, 0, `${stale} roots drawn at their old pose`)
})

test('a hide behind a backlog of a ring less one, two frozen nodes read first, is kept', () => {
  const { meshes, parks, image } = scene(100)
  const storages = frozenOnOwn([meshes[0], meshes[1]], image)
  const filler = new G.Object3D()
  storages.forEach((own, k) => (own[12] = 9 + k))
  meshes[0].matrixWorldNeedsUpdate = true
  meshes[1].matrixWorldNeedsUpdate = true
  meshes[3].visible = false
  for (let k = 0; k < 4096 - 4; k++) noteNodeWrite(filler)
  parks.length = 0
  image()
  assert.deepEqual(parks, [3], 'the hidden root parked')
})

test('an engine move of a frozen and a free node: the next image reads no write back', () => {
  const { meshes, rt, run, sent, image } = scene(20)
  meshes[1].matrixAutoUpdate = false
  image()
  const moved = new Float32Array(32)
  for (const k of [0, 1])
    copyMatrix4(moved, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, k, 0, 1], k * 16)
  const before = run.gate.revisions.scene
  setWebgpuTransforms(rt, [meshes[1], meshes[2]], moved)
  sent.length = 0
  image()
  assert.equal(run.gate.revisions.scene, before + 1, 'the move’s one revision')
  assert.equal(rt.timing.worldCounts.rootsUploaded, 2, 'the two the engine moved, once')
  assert.deepEqual(sent, [2])
})

test('two thousand one hundred twins moved an image scan the nodes moved alone, at 4·10³ as at 10⁵', () => {
  const scans = [4e3, 1e5].map((count) => {
    const { meshes, image } = scene(count)
    const reads = countScans(meshes)
    const pose = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    // The twins frozen once, as their first move freezes them; then four moves are counted.
    for (let k = 0; k < 2100; k++) meshes[k].matrixAutoUpdate = false
    image()
    const before = reads()
    for (let frame = 0; frame < 4; frame++) {
      pose[12] = frame + 1
      // What a world twin's move writes (`writeTwin`): its matrix, its update cut once.
      for (let k = 0; k < 2100; k++) {
        copyMatrix4(meshes[k].matrix.elements, pose)
        if (meshes[k].matrixAutoUpdate) meshes[k].matrixAutoUpdate = false
      }
      image()
    }
    return reads() - before
  })
  assert.equal(scans[0], scans[1], `${scans[0]} reads against ${scans[1]}`)
})
