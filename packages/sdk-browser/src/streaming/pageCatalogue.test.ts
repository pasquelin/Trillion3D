import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageStreamer } from './pageStreamer.ts';
import { servedPages } from './servedPages.fixture.ts';

test('a mounted page joins the catalogue, is read and cached, then leaves it with its bytes', async () => {
  const { pages, fetched } = await servedPages(['open.bin', 'mounted.bin']);
  const streamer = createPageStreamer([pages[0]], 'http://site.test/');
  try {
    await assert.rejects(streamer.readBytes('mounted.bin'), /Unknown page/, 'not opened with it');
    streamer.admit([pages[1]]);
    await streamer.readBytes('mounted.bin');
    assert.ok(streamer.has('mounted.bin'), 'read like a page it opened with');
    streamer.forget(['mounted.bin']);
    assert.ok(!streamer.has('mounted.bin'), 'its bytes leave with it');
    await assert.rejects(streamer.readBytes('mounted.bin'), /Unknown page/);
    assert.deepEqual(fetched, ['http://site.test/mounted.bin']);
  } finally {
    streamer.dispose();
  }
});
