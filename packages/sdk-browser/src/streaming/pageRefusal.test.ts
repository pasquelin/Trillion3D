import test from 'node:test';
import assert from 'node:assert/strict';
import { answering } from '../cluster/answers.fixture.ts';
import { createPageStreamer } from './pageStreamer.ts';

test('a page the server refuses (404, 403) is asked once, never the three attempts of a 5xx', async (t) => {
  for (const status of [404, 403]) {
    t.mock.restoreAll();
    const asked = answering(t, 'gone.bin', [status]);
    const pages = [{ url: 'gone.bin', bytes: 12, sha256: 'unused' }];
    const streamer = createPageStreamer(pages, 'http://cache/');
    try {
      await assert.rejects(streamer.request(['gone.bin']), /PAGE_STREAM_FAILED.*after one attempt/);
      assert.equal(asked.length, 1);
      assert.equal(streamer.failed('gone.bin'), true);
    } finally {
      streamer.dispose();
    }
  }
});
