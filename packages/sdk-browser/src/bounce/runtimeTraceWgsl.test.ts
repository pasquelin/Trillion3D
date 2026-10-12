// The run-time proxy's rays, the shipped WGSL run as JavaScript (`shaderRun`) over the same scene the
// CPU oracle walks (`runtimeSceneOracle.fixture.ts`): the two give the same hit and spend the same budget.
import test from 'node:test'
import assert from 'node:assert/strict'
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
