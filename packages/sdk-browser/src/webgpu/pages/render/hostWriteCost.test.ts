// A host pose write costs what it changed, never the scene: the node written names the roots under
// it (`noteListed`), whose worlds alone are compared and sent, and the rows of no other root are
// rewritten. On generated scenes of 10³ and 10⁵ meshes, one host pose write an image.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { runtime, selectionRoot } from '../../core/transformShear.fixture.ts'
import { hostWorldPlacements } from '../../../host/world/placements.ts'
import { uploadWorlds } from './worldUpload.ts'

/** A scene of `count` meshes under one group, each a selection root, its first image taken. */
function scene(count: number) {
  const source = new G.Group(),
    first = G.mesh()
  const meshes = [first, ...Array.from({ length: count - 1 }, () => G.mesh(first.geometry))]
  for (const mesh of meshes) source.add(mesh)
  const worlds = hostWorldPlacements(source)
  const roots = meshes.map((mesh) => selectionRoot(mesh, [-1, -1, -1, 1, 1, 1], worlds))
  const { rt, run } = runtime(source, roots, worlds)
  const sent: number[] = [],
    parks: number[] = []
  Object.assign(rt, {
    vis: {},
    timing: { worldCounts: { rootsUploaded: 0 } },
    blendState: { ...rt.blendState, blendGpu: [] },
  })
  Object.assign(rt.layout, { worldUpdates: new Float32Array(count * 16) })
  run.gpuSelection = {
    // What a send compares and copies: the worlds of every root, or of those named.
    updateWorlds: (_: Float32Array, named?: Int32Array) => (
      sent.push(named ? named.length : count),
      named ?? new Int32Array(0)
    ),
    parkWorld: (rank: number) => void parks.push(rank),
    markWorld() {},
  } as never
  const drawn = roots.map((root) => root.pages[0])
  const image = () => {
    run.gate.readScene(source, drawn)
    uploadWorlds(rt)
  }
  image()
  return { meshes, roots, rt, sent, parks, image }
}

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
