// A host pose write costs what it changed, never the scene: the node written names the roots under
// it (`noteMoved`), whose worlds alone are compared and sent, and the rows of no other root are
// rewritten; a light set through the engine walks no root, and a hide or a matrix announced has the
// scene watch read that node alone. On generated scenes of 10³ and 10⁵ meshes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { countScans, hostScene as scene, withLightStore } from './hostWrite.fixture.ts'
import { refreshSceneLights } from '../io/hostApi.ts'

test('one host pose write an image costs the same at 10³ and 10⁵ roots', () => {
  const costs = [1e3, 1e5].map((count) => {
    const { meshes, rt, sent, image } = scene(count)
    const uploaded: number[] = []
    sent.length = 0
    for (let frame = 0; frame < 8; frame++) {
      meshes[frame * 7].position.x += 1
      image()
      uploaded.push(rt.timing.worldCounts.rootsUploaded)
    }
    return { uploaded, sent: [...sent] }
  })
  assert.deepEqual(costs[0], costs[1], 'the same work whatever the scene')
  assert.deepEqual(costs[0].uploaded, Array(8).fill(1), 'the written mesh’s root alone')
  assert.deepEqual(costs[0].sent, Array(8).fill(1))
})

test('a host hide flips the roots under the node hidden alone, at 10³ as at 10⁵ roots', () => {
  for (const count of [1e3, 1e5]) {
    const { meshes, roots, parks, image } = scene(count)
    parks.length = 0
    meshes[5].visible = false
    image()
    assert.deepEqual(parks, [5], `${count} roots`)
    assert.ok(roots[5].parked && !roots[4].parked)
  }
})

test('a light set through the engine an image walks no root, at 10³ as at 10⁵ roots', () => {
  for (const count of [1e3, 1e5]) {
    const { rt, sent, image } = scene(count)
    withLightStore(rt)
    sent.length = 0
    for (let frame = 0; frame < 4; frame++) {
      refreshSceneLights(rt)
      image()
      assert.equal(rt.timing.worldCounts.rootsUploaded, 0, `${count} roots, image ${frame}`)
    }
    assert.deepEqual(sent, [], 'nothing sent')
  }
})

test('one hide and one announced matrix an image scan the same nodes at 10³ and 10⁵', () => {
  const scans = [1e3, 1e5].map((count) => {
    const { meshes, image } = scene(count)
    const reads = countScans(meshes)
    const before = reads()
    for (let frame = 0; frame < 4; frame++) {
      meshes[frame * 3].visible = false
      meshes[frame * 3 + 1].matrixWorldNeedsUpdate = true
      image()
    }
    return reads() - before
  })
  assert.equal(scans[0], scans[1], `${scans[0]} reads against ${scans[1]}`)
})
