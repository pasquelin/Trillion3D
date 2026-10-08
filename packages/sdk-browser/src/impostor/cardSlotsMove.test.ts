// A card segment that fills moves to the end of the records: its records alone go up at the next
// upload, never every record; the records' room grown leaves the upload as it was. On a generated
// set of 40 meshes of 64 cards each.
import test from 'node:test'
import assert from 'node:assert/strict'
import './lent.fixture.ts'
import { CARD_FLOATS, createCardSlots, slotAtEnd, uploaded, type CardSegment } from './cardSlots.ts'

test('a segment moved to the end writes its own records, not every record', () => {
  const slots = createCardSlots(),
    segments: CardSegment<string>[] = []
  const take = (segment: CardSegment<string>) => {
    slotAtEnd(slots, segments, segment)
    segment.count++
  }
  for (let mesh = 0; mesh < 40; mesh++) {
    const segment = { start: 0, capacity: 0, count: 0 } as CardSegment<string>
    segments.push(segment)
    for (let k = 0; k < 64; k++) take(segment)
  }
  uploaded(slots)
  // The first segment, full, takes one card more: it moves past every other.
  const first = segments[0]
  take(first)
  assert.equal(first.start + first.capacity, slots.used, 'moved to the end')
  assert.ok(slots.records.length >= slots.used * CARD_FLOATS)
  assert.equal(slots.full, false, 'not every record')
  assert.equal(slots.dirty.listed.count, 64, 'its 64 records')
})
