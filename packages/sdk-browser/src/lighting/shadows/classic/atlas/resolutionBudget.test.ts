import test from 'node:test'
import assert from 'node:assert/strict'
import { VSM_LEVEL0_TEXELS } from '../../vsm/constants.ts'
import { capResolutionChanges, type BudgetedLight } from './resolutionBudget.ts'

const light = (key: number, mapCount: number, resolution: number): BudgetedLight => ({
  key,
  spot: mapCount === 1,
  resolution,
})

test("the lights past the limit keep last frame's resolution, each kind counted apart", () => {
  const held = new Map([
    [0, 3],
    [10, 3],
    [20, 3],
    [30, 3],
  ])
  const lights = [light(0, 6, 1024), light(10, 6, 1024), light(20, 1, 1024), light(30, 1, 1024)]
  capResolutionChanges(lights, held, 1, 1)
  assert.deepEqual(
    lights.map((l) => l.resolution),
    [1024, 2048, 1024, 2048],
  )
  assert.equal(held.get(0), 4)
  assert.equal(held.get(10), 3)
})

test('a negative limit is none, a new light is never held, a light gone is forgotten', () => {
  const held = new Map([
    [0, 3],
    [99, 3],
  ])
  const lights = [light(0, 6, 1024), light(10, 1, 512)]
  capResolutionChanges(lights, held, -1, 0)
  assert.equal(lights[0]!.resolution, 1024)
  assert.equal(lights[1]!.resolution, 512)
  assert.deepEqual([...held.keys()].sort(), [0, 10])
})

test('the lights that waited longest are served first, so none starves', () => {
  const held = new Map([
    [0, 3],
    [1, 3],
  ])
  const waits = new Map()
  // Frame 1: both ask a smaller map; the first is served, the second waits.
  const first = [light(0, 6, 512), light(1, 6, 512)]
  capResolutionChanges(first, held, 1, 1, waits)
  assert.deepEqual([held.get(0), held.get(1), waits.get(1)], [5, 3, 1])
  // Frame 2: the first asks its old size again, the second still the smaller one; the second has waited and goes first.
  const second = [light(0, 6, 2048), light(1, 6, 512)]
  capResolutionChanges(second, held, 1, 1, waits)
  assert.deepEqual([held.get(0), held.get(1)], [5, 5])
  assert.equal(second[1]!.resolution, 512)
  assert.equal(second[0]!.resolution, VSM_LEVEL0_TEXELS >> 5)
  assert.equal(waits.size, 1)
})

test('a map shrinks only once the resolution asked has dropped half of the way to the new size', () => {
  const held = new Map([[0, 3]])
  // 2048 texels now; the next mip is 1024. A request of 1800 has dropped 12 % of the way: held.
  const near = [light(0, 6, 1800)]
  capResolutionChanges(near, held, -1, -1)
  assert.equal(near[0]!.resolution, 2048)
  assert.equal(held.get(0), 3)
  // 1100 has dropped 92 %: it shrinks.
  const far = [light(0, 6, 1100)]
  capResolutionChanges(far, held, -1, -1)
  assert.equal(far[0]!.resolution, 1100)
  assert.equal(held.get(0), 4)
})
