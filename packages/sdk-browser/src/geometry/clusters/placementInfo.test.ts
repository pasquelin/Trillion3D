// The placement record's switches word carries the object's bits (`PLACEMENT_INFO.at.switches`): a default object
// carries none, one that lets the contact shadow rays through carries `PLACEMENT_NO_CONTACT_SHADOW`, beside the marks
// it already carried, and its lighting channels stored from `PLACEMENT_CHANNELS_SHIFT` (zero for the default).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlacementInfo, type PlacementInfoSource } from './placementInfo.ts'
import {
  PLACEMENT_CHANNELS_SHIFT,
  PLACEMENT_EVALUATE,
  PLACEMENT_FIRST_PERSON,
  PLACEMENT_HOLDOUT,
  PLACEMENT_INFO,
  PLACEMENT_INFO_BYTES,
  PLACEMENT_INFO_WORDS,
  PLACEMENT_NO_CONTACT_SHADOW,
  PLACEMENT_VELOCITY,
} from '../dag/info/placementInfoLayout.ts'
import { objectOffsetRow } from '../rows/page/offsetRow.ts'
import { offsetSwitchesOf } from '../../../../sdk-core/src/world/object/offsetSwitches.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'

/** The switches words of the records the placements write, by rank. */
function switchesOf(rows: (ReturnType<typeof objectOffsetRow> | undefined)[]) {
  const info = createPlacementInfo()
  const source: PlacementInfoSource = {
    deformWord: () => 0,
    offsets: (rank) => rows[rank],
    hlod: () => 0,
    infoShift: () => 0,
    pageBase: () => 0,
    outputs: () => undefined,
    pageCount: () => 0,
  }
  info.bind(source)
  info.markAll(rows.length)
  const written: number[] = []
  const buffer = { size: rows.length * PLACEMENT_INFO_BYTES } as GPUBuffer
  const device = {
    queue: {
      writeBuffer: (_: GPUBuffer, at: number, data: Uint32Array) => {
        for (let k = 0; k * PLACEMENT_INFO_WORDS < data.length; k++)
          written[at / PLACEMENT_INFO_BYTES + k] =
            data[k * PLACEMENT_INFO_WORDS + PLACEMENT_INFO.at.switches]
      },
    },
  } as unknown as GPUDevice
  info.flush(device, buffer, { size: 0 } as GPUBuffer, true)
  return written
}

test('a placement carries the contact shadow mark only for an object that lets the rays through', () => {
  const stops = object.mesh(geometry.box(1, 1, 1))
  const lets = object.mesh(geometry.box(1, 1, 1))
  lets.castContactShadow = false
  const heldOut = object.mesh(geometry.box(1, 1, 1))
  heldOut.holdout = true
  heldOut.castContactShadow = false
  const rowOf = (node: typeof stops) => objectOffsetRow(node, [0, 0, 0])
  assert.equal(offsetSwitchesOf(stops).castContactShadow, true)
  assert.equal(rowOf(stops).bits, 0, 'a default object names nothing')
  assert.equal(rowOf(lets).bits, PLACEMENT_NO_CONTACT_SHADOW)
  const [none, mark, both, plain] = switchesOf([
    rowOf(stops),
    rowOf(lets),
    rowOf(heldOut),
    undefined,
  ])
  const base = PLACEMENT_EVALUATE | PLACEMENT_VELOCITY
  assert.equal(none, base, 'the marks of a default object are those it always had')
  assert.equal(mark, base | PLACEMENT_NO_CONTACT_SHADOW)
  assert.equal(both, base | PLACEMENT_NO_CONTACT_SHADOW | PLACEMENT_HOLDOUT)
  assert.equal(plain, base, 'a placement with no row')
})

test('a placement carries the object’s lighting channels stored, in bits of their own', () => {
  const stops = object.mesh(geometry.box(1, 1, 1))
  const lit = object.mesh(geometry.box(1, 1, 1))
  lit.lightingChannels = { channel0: false, channel1: true, channel2: true }
  const first = object.mesh(geometry.box(1, 1, 1))
  first.firstPerson = true
  first.lightingChannels = { channel0: true, channel1: true, channel2: false }
  const rowOf = (node: typeof stops) => objectOffsetRow(node, [0, 0, 0])
  assert.equal(rowOf(stops).bits, 0, 'the default channels name nothing')
  const [none, channelled, withMark] = switchesOf([rowOf(stops), rowOf(lit), rowOf(first)])
  const base = PLACEMENT_EVALUATE | PLACEMENT_VELOCITY
  assert.equal(none, base)
  // 0b110 stored is 0b111, 0b011 is 0b010.
  assert.equal(channelled, base | (7 << PLACEMENT_CHANNELS_SHIFT))
  assert.equal(withMark, base | PLACEMENT_FIRST_PERSON | (2 << PLACEMENT_CHANNELS_SHIFT))
})

test('what the views alone read of an object never reaches its placement’s record', () => {
  const seen = object.mesh(geometry.box(1, 1, 1))
  seen.ownerNoSee = true
  seen.onlyOwnerSee = true
  const row = objectOffsetRow(seen, [0, 0, 0])
  assert.equal(row.bits, 0, 'the object’s word holds none of them')
  const [word] = switchesOf([row])
  assert.equal(word, PLACEMENT_EVALUATE | PLACEMENT_VELOCITY, 'the placement’s holds none')
})
