import test from 'node:test'
import assert from 'node:assert/strict'
import type { PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'
import { box } from '../../../sdk-core/src/world/geometry/basic.ts'
import { Material } from '../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { repeated, residentAt } from './tileShapes.fixture.ts'
import { landed, owners, settle, streamedModel } from './tiles.fixture.ts'

/** A model placing one tile `count` times, opened within `bodies` bodies and `budget`, and
 *  settled around the origin: the streamer. */
async function filled(count: number, bodies: number, budget: Partial<PhysicsBudget> = {}) {
  const streamer = await streamedModel(repeated(count), new Uint8Array(1), { bodies, ...budget })
  await settle(streamer, [0, 0, 0], 1e6)
  return streamer
}

/** A page's unit box, its body asking `physics`. */
const crate = (physics: unknown) => {
  const mesh = new Mesh(box(1, 1, 1), new Material('meshStandard'))
  mesh.physics = physics as Mesh['physics']
  return mesh
}

test('a body refused for its bytes takes no tile body’s slot: one is taken only when the slot alone is missing', async () => {
  const { bodies, model } = await filled(100, 8)
  const owner = { model, body: {} } as never
  assert.throws(() => bodies.claim(1e12, 0, owner), { code: 'PHYSICS_BUDGET' })
  assert.equal(bodies.count.bodies, 8, 'every tile body kept')
  bodies.claim(0, 0, owner)
  assert.deepEqual([bodies.count.bodies, Math.max(...residentAt(bodies, 8))], [8, 60])
})

test('a page body refused as decorative or for its triangles evicts no tile body', async () => {
  // No decorative body, a share of 50 bytes: a box of twelve triangles asks 192.
  const { bodies, scene } = await filled(100, 8, { decorative: 0, memoryBytes: 100 })
  scene.add(crate({ type: 'dynamic', decorative: true }))
  scene.add(crate({ type: 'static', shape: { type: 'triangles' } }))
  const refused: { details: { budget?: string } }[] = []
  bodies.reconcile(new Set(), (error) => refused.push(error as never))
  assert.deepEqual(
    refused.map((error) => error.details.budget),
    ['decorative', 'memoryBytes'],
  )
  assert.deepEqual([bodies.count.bodies, Math.max(...residentAt(bodies, 8))], [8, 70])
})

test('a page body no slot is left for, even after the tiles’, is refused before it is built', async () => {
  const { bodies, scene } = await filled(0, 2)
  const crates = [crate('dynamic'), crate('dynamic'), crate('dynamic')]
  for (const one of crates) scene.add(one)
  // The third one's shape is never built: reading its geometry fails the test.
  Object.defineProperty(crates[2], 'geometry', {
    get: () => assert.fail('built'),
  })
  const refused: { details: { budget?: string } }[] = []
  bodies.reconcile(new Set(), (error) => refused.push(error as never))
  assert.deepEqual(
    [bodies.count.bodies, refused.map((error) => error.details.budget)],
    [2, ['bodies']],
  )
})

test('a tile body evicted for a page body is built again by the next update alone, its tile landing meanwhile or not', async () => {
  const streamer = await streamedModel(repeated(100), new Uint8Array(1), { bodies: 8 })
  const { tiles, bodies, scene } = streamer
  // Its tile asked, then left out before it lands.
  tiles.update([0, 0, 0], 5)
  tiles.update([1e5, 0, 0], 5)
  await landed()
  /** The placements of the tile bodies among the first eight slots. */
  const placements = () =>
    owners(bodies, 8).flatMap((owner) => ('tile' in owner ? [owner.tile] : []))
  const evicted = new Set<unknown>()
  tiles.update([0, 0, 0], 1e5)
  // Between two landings of the update's turn: a page body takes a tile body's slot, and leaves.
  queueMicrotask(() => {
    const before = placements(),
      one = crate('dynamic')
    scene.add(one)
    bodies.reconcile(new Set(), (error) => assert.fail(String(error)))
    scene.remove(one)
    bodies.reconcile(new Set(), (error) => assert.fail(String(error)))
    for (const p of before) if (p.id < 0) evicted.add(p)
  })
  tiles.update([0, 0, 0], 1e5)
  await landed()
  assert.deepEqual(
    placements().filter((p) => evicted.has(p)),
    [],
    'none built again before the next update',
  )
  await settle(streamer, [0, 0, 0], 1e5)
  assert.equal(bodies.count.bodies, 8)
})

test('a refused placement leaves its opening of a hundred thousand alone, the rest built on', async () => {
  const streamer = await filled(100_000, 64)
  const { tiles, bodies } = streamer
  const ids = owners(bodies, 64).flatMap((owner) => ('tile' in owner ? [owner.tile.id] : []))
  for (const id of ids) tiles.refused(id)
  assert.equal(bodies.count.bodies, 0)
  await settle(streamer, [0, 0, 0], 1e6)
  // The next nearest sixty-four, none of the refused.
  assert.deepEqual([bodies.count.bodies, Math.min(...residentAt(bodies, 64))], [64, 640])
})
