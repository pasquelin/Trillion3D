// Geometry pages over a network (#921): the reference scene served over HTTP, opened once with
// answers at once and once with every answer a round trip late (60 ms). Asserts what the page reads
// promise, never how long they take: the reads an admission pass waits for overlap on the network
// (#997), the pool ends up with the same pages, and the view ahead looks a round trip further
// (#999). How a server encodes the objects it serves is the server's, not the engine's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assetsManifest, DEFAULT_SCENE } from '../../../bench/runner/assets/scene.ts';
import { PREFETCH_HORIZON_MS } from '../../../packages/sdk-browser/src/backend/common.ts';
import { runOnDawn } from '../kit/onDawn.ts';
import { readOverNetwork, sentAlongside, servedAssets } from './networkReading.ts';

const ROUND_TRIP_MS = 60;

/** The reference scene opened over a network of `roundTripMs`: what the page read, and the
 *  transfers the network carried. */
async function openOver(roundTripMs: number) {
  const network = await servedAssets(roundTripMs);
  const errors: string[] = [];
  try {
    const manifestUrl = `${network.origin}${assetsManifest(DEFAULT_SCENE, true)}`;
    const reading = await runOnDawn(() => readOverNetwork(manifestUrl, 24, 300_000), null, errors);
    return {
      ...reading,
      errors: [...errors, ...reading.failures],
      transfers: network.transfers.length,
      alongside: sentAlongside(network.transfers),
      farthest: Math.max(...reading.horizons),
    };
  } finally {
    await network.close();
  }
}

test(
  'geometry page reads overlap on a slow network and look a round trip further',
  { timeout: 600_000 },
  async () => {
    const near = await openOver(0),
      far = await openOver(ROUND_TRIP_MS);
    for (const [name, r] of Object.entries({ near, far })) {
      console.log(
        `${name}: ${r.admitted.length} admitted, ${r.alongside}/${r.transfers} reads sent alongside ` +
          `another, horizon up to ${r.farthest} ms, held ${r.held}, errors ${r.errors.join(' | ') || 'none'}`,
      );
      assert.deepEqual(r.errors, []);
      assert.ok(r.held, 'the still image is held');
      assert.ok(
        r.horizons.length && r.horizons.every(Number.isFinite),
        'frames trace aheadHorizonMs',
      );
    }
    // #997: an admission pass starts the reads it will wait for before it admits the first, so they
    // share the network; one read at a time leaves a read alone on it.
    assert.ok(
      far.alongside * 2 > far.transfers,
      'most geometry page reads are sent while another is in flight',
    );
    // The same pages, not the same sequence: the slower network looks a round trip further ahead
    // (#999), so its passes differ. The order within a pass, whatever order the reads come back in,
    // is proved in Node (`webgpu/residency/admissionReadsOrder.test.ts`).
    assert.deepEqual(
      [...far.admitted].sort(),
      [...near.admitted].sort(),
      'the pool admits the same pages',
    );
    // #999: the view ahead adds the measured round trip, which the network keeps above its delay.
    assert.ok(
      far.farthest >= PREFETCH_HORIZON_MS + ROUND_TRIP_MS,
      'the horizon adds the round trip',
    );
    assert.ok(near.farthest < far.farthest, 'a nearer network looks less far ahead');
  },
);
