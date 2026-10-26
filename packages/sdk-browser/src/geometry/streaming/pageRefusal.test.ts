import test from 'node:test'
import assert from 'node:assert/strict'
import { answering } from '../cluster/answers.fixture.ts'
import { createPageStreamer } from './pageStreamer.ts'
import { createPageCache } from './pageCache.ts'

test('a page the server refuses (404, 403) is asked again as any failed read, its three tries, then given up', async (t) => {
  for (const status of [404, 403]) {
    t.mock.restoreAll()
    const asked = answering(t, 'gone.bin', [status])
    const pages = [{ url: 'gone.bin', bytes: 12, sha256: 'unused' }]
    const streamer = createPageStreamer(pages, 'http://cache/', { cache: createPageCache() })
    try {
      await assert.rejects(
        streamer.request(['gone.bin'], { signal: streamer.signal }),
        /PAGE_STREAM_FAILED.*after 4 attempts/,
      )
      assert.equal(asked.length, 4)
      assert.equal(streamer.failed('gone.bin'), true)
    } finally {
      streamer.dispose()
    }
  }
})
