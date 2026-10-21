// Geometry pages over a network: the reference scene served over HTTP, opened once with
// answers at once and once with every answer a round trip late (60 ms). Asserts what the page reads
// promise, never how long they take: the reads the streaming queue keeps pending overlap on the
// network, and the pool ends up with the same pages. How a server encodes the objects it serves is
// the server's, not the engine's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assetsManifest, DEFAULT_SCENE } from '../../../bench/runner/assets/scene.ts'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { readOverNetwork, sentAlongside, servedAssets } from './networkReading.ts'

const ROUND_TRIP_MS = 60

/** The reference scene opened over a network of `roundTripMs`: what the page read, and the
 *  transfers the network carried. */
async function openOver(roundTripMs: number) {
  const network = await servedAssets(roundTripMs)
  const errors: string[] = []
  try {
    const manifestUrl = `${network.origin}${assetsManifest(DEFAULT_SCENE, true)}`
    const reading = await runOnDawn(() => readOverNetwork(manifestUrl, 24, 300_000), null, errors)
    return {
      ...reading,
      errors: [...errors, ...reading.failures],
      transfers: network.transfers.length,
      alongside: sentAlongside(network.transfers),
    }
  } finally {
    await network.close()
  }
}

test(
  'geometry page reads overlap on a slow network and fill the pool with the same pages',
  { timeout: 600_000 },
  async () => {
    const near = await openOver(0),
      far = await openOver(ROUND_TRIP_MS)
    for (const [name, r] of Object.entries({ near, far })) {
      console.log(
        `${name}: ${r.admitted.length} admitted, ${r.alongside}/${r.transfers} reads sent alongside ` +
          `another, held ${r.held}, errors ${r.errors.join(' | ') || 'none'}`,
      )
      assert.deepEqual(r.errors, [])
      assert.ok(r.held, 'the still image is held')
    }
    // The streaming queue keeps many requests pending at once (`geometry/residency/queue.ts`), so
    // their reads share the network; one read at a time leaves a read alone on it.
    assert.ok(
      far.alongside * 2 > far.transfers,
      'most geometry page reads are sent while another is in flight',
    )
    // The same pages, not the same sequence: the reads come back in another order on the slower
    // network, so its installs differ.
    assert.deepEqual(
      [...far.admitted].sort(),
      [...near.admitted].sort(),
      'the pool admits the same pages',
    )
  },
)
