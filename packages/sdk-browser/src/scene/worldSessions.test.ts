// A world's HLOD outlives its sessions: a session closed before it binds is never read through.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPageCache } from '../streaming/pageCache.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { heldBy, opened, served } from './worldRoots.fixture.ts'

const turns = async (count = 4) => {
  for (let i = 0; i < count; i++) await new Promise(setImmediate)
}

test('a session closed before it binds is refused: a hold waits for the next one, never spins', async (t) => {
  const { manifest } = served(t)
  const { roots, queue } = await opened(t, manifest)
  queue.dispose() // the device is lost
  const dead = createPageStreamer([], 'http://world/', { cache: createPageCache() })
  dead.dispose() // the next session's signal aborts during its capability probe
  roots.bind(dead)
  let landed = false
  const held = roots.hold(1).then(() => (landed = true))
  await turns()
  assert.equal(landed, false, 'it waits, bound to nothing')
  const next = createPageStreamer([], 'http://world/', { cache: createPageCache() })
  t.after(() => next.dispose())
  roots.bind(next)
  await held
  assert.deepEqual(heldBy(roots), [2, 3])
})
