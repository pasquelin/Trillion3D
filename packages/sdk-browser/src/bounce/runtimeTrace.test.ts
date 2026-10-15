import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldRay, world } from './runtimeScene.fixture.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'
import { RAY_TRIANGLES, RAY_WORK } from './runtimeLayout.ts'
import { freshSpent, spent } from './runtimeOracle.fixture.ts'
import { bruteForce, traceScene } from './runtimeSceneOracle.fixture.ts'

/** `count` cubes turned and stretched, packed with the culling's tree (a tree from 65 placements on). */
const scene = (count: number, seed: number) => world(count, seed).scene

for (const count of [5, 64, 65, 400]) {
  test(`${count} placements: the two-level walk finds what every triangle finds`, () => {
    const world = scene(count, count)
    assert.equal(!!world.packed.placementTree, count > 64, 'the tree starts above 64 placements')
    const random = lcgRandom(7)
    let hits = 0
    for (let ray = 0; ray < 300; ray++) {
      const { origin, direction } = fieldRay(random, count)
      const cost = freshSpent()
      const got = traceScene(world, origin, direction, 100, cost)
      const want = bruteForce(world, origin, direction, 100)
      // A ray that spent its budget answers nothing: that is the rule, not a miss.
      if (spent(cost)) continue
      assert.equal(
        got.found,
        want.found,
        `ray ${ray} got ${JSON.stringify(got)} want ${JSON.stringify(want)} spent ${JSON.stringify(cost)}`,
      )
      if (want.found) {
        hits++
        assert.ok(Math.abs(got.distance - want.distance) < 1e-4 * want.distance, `ray ${ray}`)
        assert.equal(got.placement, want.placement)
      }
    }
    assert.ok(hits > 20, `${hits} rays met a cube`)
  })
}

test('a ray never spends more than its budget, whatever it crosses', () => {
  const world = scene(400, 3)
  const random = lcgRandom(11)
  for (let ray = 0; ray < 200; ray++) {
    const origin: [number, number, number] = [random() * 60, 2, random() * 60]
    const direction: [number, number, number] = [
      random() - 0.5,
      random() * 0.1 - 0.05,
      random() - 0.5,
    ]
    const cost = freshSpent()
    traceScene(world, origin, direction, 1e6, cost)
    // The last box or triangle test may end past the counter by what one node costs.
    assert.ok(cost.work <= RAY_WORK + 64, `${cost.work} units`)
    assert.ok(cost.tests <= RAY_TRIANGLES, `${cost.tests} triangles`)
  }
})
