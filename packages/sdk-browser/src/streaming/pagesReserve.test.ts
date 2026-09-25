// The CPU total holds the decoded pages and the engine's scene-sized tables together: what the
// engine reserves once prepared comes out of the page cache's share (`../residency/memoryBudget.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../measurement/sha256Hex.ts';
import { createPageStreamer } from './pageStreamer.ts';

test('bytes reserved for the engine tables come out of the cache budget', async () => {
  const bytes = new Uint8Array(12);
  const sha = await sha256Hex(bytes.buffer);
  globalThis.fetch = async () => new Response(bytes, { status: 200 });
  const urls = ['a.bin', 'b.bin', 'c.bin'];
  const pages = urls.map((url) => ({ url, bytes: 12, sha256: sha }));
  // Room for three pages of twelve bytes, and no count cap.
  const streamer = createPageStreamer(pages, 'http://cache/', {
    workerCount: 2,
    maxPages: 0,
    maxTransferBytes: 64,
    maxCachedBytes: 36,
  });
  await streamer.request(urls);
  streamer.retain(['a.bin']);
  assert.equal(streamer.stats().resident, 3);
  streamer.reserve(() => 20);
  assert.deepEqual(
    urls.filter(streamer.has),
    ['a.bin'],
    'twenty bytes reserved leave room for one',
  );
  streamer.dispose();
});
