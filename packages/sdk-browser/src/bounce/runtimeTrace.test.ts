import test from 'node:test'
import assert from 'node:assert/strict'
import { stream, world } from './runtimeScene.fixture.ts'
import { RAY_TRIANGLES, RAY_WORK } from './runtimeLayout.ts'
import type { Spent } from './runtimeOracle.fixture.ts'
import { bruteForce, traceScene } from './runtimeSceneOracle.fixture.ts'

/** `count` cubes turned and stretched, packed with the culling's tree (a tree from 65 placements on). */
const scene = (count: number, seed: number) => world(count, seed).scene

const fresh = (): Spent => ({ work: 0, tests: 0 })

for (const count of [5, 64, 65, 400]) {
  test(`${count} placements: the two-level walk finds what every triangle finds`, () => {
    const world = scene(count, count)
    assert.equal(!!world.packed.placementTree, count > 64, 'the tree starts above 64 placements')
    const random = stream(7)
    const side = Math.ceil(Math.sqrt(count)) * 3
    let hits = 0
    for (let ray = 0; ray < 300; ray++) {
      const origin: [number, number, number] = [random() * side, 4 + random() * 2, random() * side]
      const target: [number, number, number] = [random() * side, 0.5, random() * side]
      const direction = target.map((v, k) => v - origin[k]) as [number, number, number]
      const spent = fresh()
      const got = traceScene(world, origin, direction, 100, spent)
      const want = bruteForce(world, origin, direction, 100)
      // A ray that spent its budget answers nothing: that is the rule, not a miss.
      if (spent.work >= RAY_WORK || spent.tests >= RAY_TRIANGLES) continue
      assert.equal(
        got.found,
        want.found,
        `ray ${ray} got ${JSON.stringify(got)} want ${JSON.stringify(want)} spent ${JSON.stringify(spent)}`,
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
  const random = stream(11)
  for (let ray = 0; ray < 200; ray++) {
    const origin: [number, number, number] = [random() * 60, 2, random() * 60]
    const direction: [number, number, number] = [
      random() - 0.5,
      random() * 0.1 - 0.05,
      random() - 0.5,
    ]
    const spent = fresh()
    traceScene(world, origin, direction, 1e6, spent)
    // The last box or triangle test may end past the counter by what one node costs.
    assert.ok(spent.work <= RAY_WORK + 64, `${spent.work} units`)
    assert.ok(spent.tests <= RAY_TRIANGLES, `${spent.tests} triangles`)
  }
})
