// The host bytes a session reserves beside the streamer count the impostor tier's: the watch's
// per-root tables and heaps, and the card records. On the generated impostor scene, its cards
// planned at 200 metres.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../../impostor/lent.fixture.ts'
import { createImpostorCards, planImpostorCards } from '../../../impostor/cards.ts'
import {
  engineAt,
  impostorScene,
  impostorSection,
  VIEWPORT,
} from '../../../impostor/section.fixture.ts'
import { hostTableBytesOf } from './memory.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

test('the impostor tier’s watch and card records count in the host bytes', () => {
  const { fixture, roots } = impostorScene(),
    cards = createImpostorCards(impostorSection, { atlasOf: () => ({ atlas: 1 }) })
  planImpostorCards(cards, roots, engineAt(200), VIEWPORT)
  const tier = cards.watch.hostBytes + cards.slots.records.byteLength
  assert.ok(cards.watch.hostBytes > 0)
  const rt = {
    services: { hostTableBytes: () => 1000 },
    bounce: {},
    gpu: { impostors: cards },
  } as unknown as WebgpuPagesRuntime
  assert.equal(hostTableBytesOf(rt), 1000 + tier)
  fixture.geometry.dispose()
})
