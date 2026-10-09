// The host bytes a session reserves beside the streamer count every per-root table of the impostor
// tier: the watch's, its switch table's, the cards' and their objects — measured as a field of roots
// doubles, table by table and against what those tables hold a root. On generated fields of 1000
// and 2000 roots.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../../impostor/lent.fixture.ts'
import { createImpostorCards, planImpostorCards } from '../../../impostor/cards.ts'
import {
  cardField,
  engineAt,
  impostorSection,
  MESH,
  VIEWPORT,
} from '../../../impostor/section.fixture.ts'
import { hostTableBytesOf } from './memory.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** What a root holds at least in the tier's tables, in bytes. The watch: its verdict (1), the frame
 *  it was read (4), its key (8), place (4), bucket (4), slack (8), bound (8) and the three numbers
 *  the bound was taken from (24), its heap (8). The switch table: the eleven numbers of the linear
 *  part and four depths and radii (8 each), its root and entry (8 each). The cards: its card (8). */
const PER_ROOT = 1 + 4 + 8 + 4 + 4 + 8 + 8 + 24 + 8 + (11 + 4) * 8 + 2 * 8 + 8

/** The host bytes beside the streamer of a session holding a planned field of `count` roots, and
 *  the bytes of its card records. */
function bytesAt(count: number) {
  const cards = createImpostorCards(impostorSection, { atlasOf: () => ({ atlas: MESH }) })
  planImpostorCards(cards, cardField(count), engineAt(200), VIEWPORT)
  const rt = {
    services: { hostTableBytes: () => 0 },
    bounce: {},
    gpu: { impostors: cards },
  } as unknown as WebgpuPagesRuntime
  return { host: hostTableBytesOf(rt), records: cards.slots.records.byteLength, ...ownBytes(cards) }
}

/** The tier's tables read one by one, each by its own size — the watch's, the records and the
 *  slots to send, the card of each root and the roots moved, and each mesh's switched roots and
 *  cards —, and the card objects the meshes hold, which the host bytes count a fixed size each. */
function ownBytes(cards: ReturnType<typeof createImpostorCards>) {
  let tables =
      cards.watch.hostBytes +
      cards.slots.records.byteLength +
      cards.slots.dirty.listed.byteLength +
      cards.slots.dirty.sorted.byteLength +
      8 * cards.holding.length +
      cards.moves.byteLength,
    holders = 0
  for (const segment of cards.segments.values()) {
    tables += segment.eligible.byteLength + 8 * segment.cards.length
    holders += segment.holders.size
  }
  return { tables, holders }
}

test('every per-root table of the impostor tier counts in the host bytes', () => {
  const small = bytesAt(1000),
    large = bytesAt(2000)
  const grown = large.host - small.host,
    records = large.records - small.records
  assert.ok(records > 0, 'more cards, more records')
  // What the host bytes hold beyond the tables, a card object and its entry: the same a card.
  const perCard = (at: typeof small) => (at.host - at.tables) / at.holders
  assert.ok(small.holders > 0 && large.holders > small.holders)
  assert.ok(perCard(small) > 0, 'a card object and its entry counted')
  assert.equal(perCard(large), perCard(small), 'the growth, table by table, a card a fixed size')
  assert.ok(
    grown >= 1000 * PER_ROOT + records,
    `${(grown - records) / 1000} bytes a root beside the records, ${PER_ROOT} at least`,
  )
})
