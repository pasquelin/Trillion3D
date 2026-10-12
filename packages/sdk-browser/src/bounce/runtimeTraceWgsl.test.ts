// The run-time proxy's rays, the shipped WGSL run as JavaScript (`shaderRun`) over the same scene the
// CPU oracle walks (`runtimeSceneOracle.fixture.ts`): the two give the same hit and spend the same budget.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { stream, world, type Vec } from './runtimeScene.fixture.ts'
import { runOver } from './runtimeRun.fixture.ts'
import { traceScene } from './runtimeSceneOracle.fixture.ts'

for (const count of [5, 400]) {
  test(`${count} placements: the shipped WGSL walks the tree and the cuts as the oracle does`, () => {
    const w = world(count, count),
      run = runOver(w)
    const random = stream(5),
      side = Math.ceil(Math.sqrt(count)) * 3
    let hits = 0
    for (let ray = 0; ray < 120; ray++) {
      const origin: Vec = [random() * side, 4 + random() * 2, random() * side]
      const target: Vec = [random() * side, 0.5, random() * side]
      const direction = target.map((v, k) => v - origin[k]) as Vec
      const spent = { work: 0, tests: 0 }
      const want = traceScene(w.scene, origin, direction, 100, spent)
      run.testReset()
      const got = run.rtScene(origin, direction, 100)
      assert.equal(run.testWork(), spent.work, `ray ${ray} work`)
      assert.equal(run.testTests(), spent.tests, `ray ${ray} tests`)
      if (got.found) hits++
      assert.equal(got.found, want.found, `ray ${ray}`)
      if (want.found) {
        assert.ok(Math.abs(got.distance - want.distance) < 1e-3 * want.distance, `ray ${ray}`)
        assert.equal(got.placement, want.placement, `ray ${ray}`)
      }
    }
    assert.ok(hits > 3, `${hits} hits`)
  })
}

test('blended copies, members after the placements, are met as the oracle meets them', () => {
  // The tree's placements, and eight copies of the cube amongst them, each at a pose of its own.
  const copies = Array.from({ length: 8 }, (_, k) => {
    const m = new G.Matrix4()
    m.elements.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, k * 2 - 1, 0.5, 4 + k, 1])
    return m
  })
  const w = world(70, 4, { copies })
  const run = runOver(w)
  const random = stream(9)
  let hits = 0
  for (let ray = 0; ray < 150; ray++) {
    const origin: Vec = [random() * 16 - 2, 6, random() * 16]
    const direction: Vec = [random() - 0.5, -1, random() - 0.5]
    const spent = { work: 0, tests: 0 }
    const want = traceScene(w.scene, origin, direction, 100, spent)
    run.testReset()
    const got = run.rtScene(origin, direction, 100)
    assert.equal(run.testWork(), spent.work, `ray ${ray} work`)
    assert.equal(got.found, want.found, `ray ${ray}`)
    if (want.found) {
      hits++
      assert.equal(got.placement, want.placement, `ray ${ray}`)
      assert.ok(Math.abs(got.distance - want.distance) < 1e-3 * want.distance, `ray ${ray}`)
    }
  }
  assert.ok(hits > 10, `${hits} hits`)
  assert.ok(
    [...w.scene.instances.keys()].some((k) => k >= 70),
    'copies are members',
  )
})

test('a tree held in the part of a split table is walked from the part, as the whole table is', () => {
  const whole = world(300, 2),
    tree = whole.packed.placementTree!,
    part = world(300, 2, { shift: { nodes: tree.cellBase, cold: tree.members } })
  const random = stream(3)
  const a = runOver(whole),
    b = runOver(part)
  for (let ray = 0; ray < 80; ray++) {
    const origin: Vec = [random() * 50, 5, random() * 50]
    const direction: Vec = [random() - 0.5, -1, random() - 0.5]
    a.testReset()
    b.testReset()
    const one = a.rtScene(origin, direction, 100),
      two = b.rtScene(origin, direction, 100)
    assert.deepEqual(two, one, `ray ${ray}`)
    assert.equal(b.testWork(), a.testWork())
  }
})
