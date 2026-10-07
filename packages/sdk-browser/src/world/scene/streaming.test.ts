// A page read that fails reaches the host once, from the read layer (`onStalled`, `streamFailed`):
// the background batch that asked it reports nothing more.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Engine } from '../../engine/types.ts'
import { createPageStreamer } from '../../streaming/pageStreamer.ts'
import type { ExplorerSession } from '../session/session.ts'
import { createExplorerStreaming } from './streaming.ts'

test('a page the server refuses for good is told to the host once: never again by its batch', async (t) => {
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
      onStalled: () => void events.push('stalled'), // the read layer's one report
    },
  )
  t.after(() => streamer.dispose())
  const engine = { metrics: () => ({ coverageReady: false }) } as unknown as Engine
  const streaming = createExplorerStreaming(session as unknown as ExplorerSession, {
    ...{ streamer, engine, state: { disposed: false } },
    budget: { admits: () => true, spend() {}, remaining: () => Infinity } as never,
  })
  streaming.startFetch(['gone.bin'])
  await streaming.promise
  assert.deepEqual(events, ['stalled'], 'the batch keeps its failure for its owner alone')
  assert.match(String(streaming.error), /PAGE_STREAM_FAILED/)
})
