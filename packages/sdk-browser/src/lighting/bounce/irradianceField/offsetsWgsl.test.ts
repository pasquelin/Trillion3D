// The move of the field's probes off the surfaces: the kernels that write a probe's offset.

import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import {
  FIELD_OFFSETS_PROGRAM,
  FIELD_OFFSET_BINDINGS,
  GBUFFER_OFFSETS_PROGRAM,
  GBUFFER_OFFSET_BINDINGS,
  fieldOffsetEntries,
  gbufferOffsetEntries,
} from './offsetsWgsl.ts'

test('both offset kernels are modules a device takes, their bindings the layout holds', () => {
  for (const [name, code, entries, table] of [
    ['pixels', GBUFFER_OFFSETS_PROGRAM, gbufferOffsetEntries(), GBUFFER_OFFSET_BINDINGS],
    ['field', FIELD_OFFSETS_PROGRAM, fieldOffsetEntries(false), FIELD_OFFSET_BINDINGS],
  ] as const) {
    assertProgramAssembles(code, undefined, name)
    const declared = [...code.matchAll(/@group\(0\)\s*@binding\((\d+)\)/g)].map((m) => +m[1])
    const FIELD_BINDINGS = 6
    const expected = Object.entries(table).flatMap(([key, binding]) =>
      key === 'field' ? Array.from({ length: FIELD_BINDINGS }, (_, at) => binding + at) : [binding],
    )
    assert.deepEqual(
      entries.map((entry) => entry.binding).sort((a, b) => a - b),
      expected.sort((a, b) => a - b),
      `${name}: the layout holds the table`,
    )
    assert.ok(
      entries.every((entry) => declared.includes(entry.binding)),
      `${name}: declared`,
    )
  }
})

test('the offset is stored in the slot and in the queue entry, the field kernel adding to the offset it had', () => {
  assert.match(
    FIELD_OFFSETS_PROGRAM,
    /storeProbeOffset\(entry,queued\.slot,clamp\(queued\.offset\+best\.xyz,/,
  )
  for (const code of [FIELD_OFFSETS_PROGRAM, GBUFFER_OFFSETS_PROGRAM])
    assert.doesNotMatch(code, /queued\.rank/, 'adaptive probes are moved like the others')
  assert.match(GBUFFER_OFFSETS_PROGRAM, /probeQueue\[entry\*OFFSET_QUEUE_WORDS\+4u\+axis\]/)
  assert.match(
    GBUFFER_OFFSETS_PROGRAM,
    /poolSlots\[slot\*OFFSET_SLOT_WORDS\+OFFSET_SLOT_OFFSET\+axis\]/,
  )
})

// The vote of the pixels and the search of the field, on the CPU with the kernels' own numbers: the probe's offset is the mean of the votes in whole units of the cell, and the field's
// pick is the farthest place of the 64, each step of the kernel's best-of-eight.
const PRECISION = 128
const MAX_CELLS = 0.25

/** The mean of `ideals` (offsets in cells from the cell's centre, each within a quarter of a cell), summed in whole units as the kernel's atomics do; none when no pixel voted. */
function votedOffset(ideals: number[]) {
  const scale = (PRECISION * 0.5) / 1
  let sum = 0
  let votes = 0
  for (const ideal of ideals) {
    if (Math.abs(ideal) >= MAX_CELLS) continue
    votes++
    sum += Math.min(Math.max(Math.round(ideal * scale + PRECISION * 0.5), 0), PRECISION)
  }
  return votes > 0 ? (sum / votes - PRECISION * 0.5) / scale : undefined
}

/** The place of the 4 × 4 × 4 grid the field's kernel picks: the farthest of the surfaces (`distance`), the first of equals. */
function searchedPlace(distance: (offset: [number, number, number]) => number) {
  const tried = Array.from({ length: 64 }, (_, lane) => {
    const at = [lane % 4, Math.floor((lane % 16) / 4), Math.floor(lane / 16)]
    const offset = at.map((a) => ((a * 2) / 3 - 1) * MAX_CELLS) as [number, number, number]
    return { offset, w: distance(offset) }
  })
  const best = (list: typeof tried) => list.reduce((a, b) => (b.w > a.w ? b : a))
  const eights = Array.from({ length: 8 }, (_, i) => best(tried.slice(i * 8, i * 8 + 8)))
  return best(eights)
}

test('the pixels vote for the mean of their ideal places within a quarter of a cell, kept to a 64th of the cell', () => {
  assert.equal(votedOffset([]), undefined, 'no vote keeps the probe where it was')
  assert.equal(votedOffset([0.3, -0.5]), undefined, 'places past a quarter of a cell do not vote')
  const mean = votedOffset([0.1, 0.2, 0.3])!
  assert.ok(Math.abs(mean - 0.15) <= 1 / PRECISION, `${mean}`)
  assert.ok(Math.abs(votedOffset([0.1, -0.1])!) <= 1 / PRECISION)
  for (const ideals of [[0.249], [-0.249, -0.249], [0.2, -0.2, 0.1]])
    assert.ok(Math.abs(votedOffset(ideals)!) < MAX_CELLS + 1 / PRECISION)
})

test('the field search picks the farthest of the 64 places, within a quarter of a cell, and reads nothing from a field with no clipmap', () => {
  const away = searchedPlace((offset) => offset[0] + 2 * offset[1] - offset[2])
  assert.deepEqual(away.offset, [MAX_CELLS, MAX_CELLS, -MAX_CELLS])
  for (const axis of away.offset) assert.ok(Math.abs(axis) <= MAX_CELLS)
  assert.match(FIELD_OFFSETS_PROGRAM, /if\(gdfView\.clipmaps==0u\)\{return 1e30;\}/)
})
