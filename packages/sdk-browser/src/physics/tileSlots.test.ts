import test from 'node:test'
import assert from 'node:assert/strict'
import { box } from '../../../sdk-core/src/world/geometry/basic.ts'
import { Material } from '../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { repeated, residentAt, settle } from './tileShapes.fixture.ts'
import { streamedModel } from './tiles.fixture.ts'

/** A model placing one tile `count` times, opened within `bodies` bodies and settled around the
 *  origin: the streamer and the tile bodies' slots. */
async function filled(count: number, bodies: number) {
  const streamer = await streamedModel(repeated(count), new Uint8Array(1), { bodies })
  await settle(streamer, [0, 0, 0], 1e6)
  return streamer
}

test('a body refused for its bytes takes no tile body’s slot: one is taken only when the slot alone is missing', async () => {
  const { bodies, model } = await filled(100, 8)
  const owner = { model, body: {} } as never
  assert.throws(() => bodies.claim(1e12, 0, owner), { code: 'PHYSICS_BUDGET' })
  assert.equal(bodies.count.bodies, 8, 'every tile body kept')
  bodies.claim(0, 0, owner)
  assert.deepEqual([bodies.count.bodies, Math.max(...residentAt(bodies, 8))], [8, 60])
})

test('a page body no slot is left for, even after the tiles’, is refused before it is built', async () => {
  const { bodies, scene } = await filled(0, 2)
  const crates = Array.from({ length: 3 }, () => {
    const crate = new Mesh(box(1, 1, 1), new Material('meshStandard'))
    crate.physics = 'dynamic'
    scene.add(crate)
    return crate
  })
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

test('a refused placement leaves its opening of a hundred thousand alone, the rest built on', async () => {
  const streamer = await filled(100_000, 64)
  const { tiles, bodies } = streamer
  const ids = Array.from({ length: 64 }, (_, slot) => bodies.slots.at(slot)).flatMap((owner) =>
    owner && 'tile' in owner ? [owner.tile.id] : [],
  )
  for (const id of ids) tiles.refused(id)
  assert.equal(bodies.count.bodies, 0)
  await settle(streamer, [0, 0, 0], 1e6)
  // The next nearest sixty-four, none of the refused.
  assert.deepEqual([bodies.count.bodies, Math.min(...residentAt(bodies, 64))], [64, 640])
})
