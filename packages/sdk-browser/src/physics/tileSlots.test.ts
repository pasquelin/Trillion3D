import test from 'node:test'
import assert from 'node:assert/strict'
import type { PhysicsBudget } from '../../../sdk-core/src/physics/index.ts'
import { crate, owners, repeated, residentAt } from './tileShapes.fixture.ts'
import { cooked, landed, place, settle, streamedModel, tile } from './tiles.fixture.ts'

/** A model placing one tile `count` times, opened within `bodies` bodies and `budget`, and
 *  settled around the origin: the streamer. */
async function filled(count: number, bodies: number, budget: Partial<PhysicsBudget> = {}) {
  const streamer = await streamedModel(repeated(count), new Uint8Array(1), { bodies, ...budget })
  await settle(streamer, [0, 0, 0], 1e6)
  return streamer
}

/** Brings the page bodies of `bodies` in line with its scene, a refusal failing the test. */
const reconciled = (bodies: Awaited<ReturnType<typeof filled>>['bodies']) =>
  bodies.reconcile(new Set(), (error) => assert.fail(String(error)))

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
    reconciled(bodies)
    scene.remove(one)
    reconciled(bodies)
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

test('a burst of page bodies takes the farthest tile bodies’ slots, farthest first', async () => {
  const { bodies, scene } = await filled(100, 8)
  for (let i = 0; i < 3; i++) scene.add(crate('dynamic'))
  reconciled(bodies)
  assert.deepEqual([bodies.count.bodies, Math.max(...residentAt(bodies, 8))], [8, 40])
})

test('a page mesh past the share the tiles fill lets the farthest tiles go, and they stay out', async () => {
  // A share of 400 bytes, three tiles of 100, a page mesh of twelve triangles: 192.
  const tiles = [0, 10, 20].map((x) => ({ ...tile(x), bytes: 100 }))
  const file = cooked([{ kind: 'mesh', tiles }], [place(0)])
  const streamer = await streamedModel(file, new Uint8Array(1), { memoryBytes: 800 })
  const { bodies, scene, errors } = streamer
  await settle(streamer, [0, 0, 0], 100)
  assert.equal(bodies.count.collisionBytes, 300)
  scene.add(crate({ type: 'static', shape: { type: 'triangles' } }))
  reconciled(bodies)
  /** What the share holds, and the least x of each resident tile. */
  const held = () => [bodies.count.collisionBytes, residentAt(bodies, 8).sort((a, b) => a - b)]
  assert.deepEqual(held(), [392, [0, 10]], 'the farthest tile gone for it')
  await settle(streamer, [0, 0, 0], 100)
  assert.deepEqual([...held(), errors], [392, [0, 10], []], 'and not back')
})

test('a tile landing once page bodies took slots meanwhile builds what the slots left, no failure', async () => {
  const streamer = await streamedModel(repeated(100), new Uint8Array(1), { bodies: 8 })
  const { tiles, bodies, scene, errors } = streamer
  tiles.update([0, 0, 0], 1e5)
  for (let i = 0; i < 3; i++) scene.add(crate('dynamic'))
  reconciled(bodies)
  await landed()
  assert.deepEqual([bodies.count.bodies, residentAt(bodies, 8).length, errors], [8, 5, []])
  await settle(streamer, [0, 0, 0], 1e5)
  assert.deepEqual([bodies.count.bodies, errors], [8, []])
})
