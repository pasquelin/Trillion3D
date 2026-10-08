// A host pose write, then `setTransform` on another node in the same task. The move settles
// the scene watch: without care, the host's write was taken as the engine's own and only the named
// node's rows were rewritten — the other model kept its old world, corners and windings in the
// visibility table while the GPU cut saw it moved. The move notes every node written since the
// tree's last pass, the host's with its own (`noteListed`).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { setWebgpuTransform } from './transform.ts'
import { runtime } from '../../core/transformShear.fixture.ts'
import { hostWorldPlacements } from '../../../host/world/placements.ts'

/** Two drawn models, A and B, watched by the gate as the first image leaves them — or, not
 *  `hooked`, before any image. */
function twoModels(hooked = true) {
  const source = new G.Group(),
    a = G.mesh(),
    b = G.mesh()
  a.name = 'A'
  b.name = 'B'
  source.add(a, b)
  const worlds = hostWorldPlacements(source),
    { rt, run } = runtime(source, [], worlds)
  if (hooked) {
    run.gate.readScene(source, [{ sourceMesh: a }, { sourceMesh: b }])
    run.gate.updateWorlds(worlds)
  }
  return { source, a, b, worlds, rt, run }
}

const moved = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1])

test('A written by the host, then B moved: the move takes A too, and the next image reads the write', () => {
  const { a, worlds, rt, run } = twoModels()
  a.position.x = 100
  setWebgpuTransform(rt, 'B', moved)
  assert.ok(run.gate.updateWorlds(worlds), 'the host write is not swallowed')
  assert.equal(worlds.of(a).elements[12], 100)
})

test('B moved alone: the next image walks nothing, and only its rows travel', () => {
  const { worlds, rt, run } = twoModels()
  setWebgpuTransform(rt, 'B', moved)
  assert.equal(run.gate.updateWorlds(worlds), false)
})

test('before the first image, A written by the host then B moved: A stands where the host put it', () => {
  const { a, worlds, rt } = twoModels(false)
  // Nothing is hooked yet: no watch announces the write, the move walks the whole index.
  a.position.x = 100
  setWebgpuTransform(rt, 'B', moved)
  assert.equal(worlds.of(a).elements[12], 100)
})

test('A written by the host, an image held before its world pass, then B moved: A is walked', () => {
  const { source, a, b, worlds, rt, run } = twoModels()
  a.position.x = 100
  // The scan reports the write, then the image returns early (readback in flight): no pass ran.
  run.gate.readScene(source, [{ sourceMesh: a }, { sourceMesh: b }])
  setWebgpuTransform(rt, 'B', moved)
  assert.equal(worlds.of(a).elements[12], 100, 'the move walks the whole index')
  assert.ok(run.gate.updateWorlds(worlds), 'and the next image reads it')
})
