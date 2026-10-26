// A page read that fails reaches the host from the read layer alone (`onStalled`, `streamFailed`), at
// its first failure and when it is given up: the background batch that asked it reports nothing more.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Engine } from '../../session/engine/types.ts'
import { createPageStreamer } from '../../geometry/streaming/pageStreamer.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import type { ExplorerSession } from '../../session/session.ts'
import { createExplorerStreaming } from './streaming.ts'

test('a page the server refuses is told to the host at its first failure and when given up: never again by its batch', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  const events: unknown[] = []
  const session = {
    scope: 'slice',
    emit: (event: unknown) => void events.push(event),
    diagnose() {},
  }
  const streamer = createPageStreamer(
    [{ url: 'gone.bin', bytes: 4, sha256: '' }],
    'http://cache/',
    {
      cache: createPageCache(),
      onStalled: () => void events.push('stalled'), // the read layer's reports
    },
  )
  t.after(() => streamer.dispose())
  const engine = { metrics: () => ({ coverageReady: false }) } as unknown as Engine
  const streaming = createExplorerStreaming(session as unknown as ExplorerSession, {
    ...{ streamer, engine, state: { disposed: false } },
    budget: { admits: () => true, spend() {}, remaining: () => Infinity } as never,
  })
  streaming.ask(['gone.bin'])
  await streaming.pending()
  assert.deepEqual(
    events,
    ['stalled', 'stalled'],
    'the batch keeps its failure for its owner alone',
  )
  assert.match(String(streaming.error), /PAGE_STREAM_FAILED/)
})
