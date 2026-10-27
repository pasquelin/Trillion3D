// What a placement's word and its arrival tell the shadows beyond its mobility: the lighting channels
// it carries (`castFlags.ts`), and the arrivals the diff's state per view clears (`mobilityState.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { MOBILITY_CAST_BITS, MOBILITY_CHANNELS_SHIFT } from '../mobilityBits.ts'
import { castFlagsOf } from './castFlags.ts'
import { rootWordsTwin } from './rootWords.fixture.ts'
import { createShadowMobility } from './mobility.ts'
import { PLACEMENT_CHANNELS_SHIFT } from '../../../geometry/dag/info/placementInfoLayout.ts'
import {
  ALL_LIGHTING_CHANNELS_MASK,
  storedChannelsOf,
} from '../../../../../sdk-core/src/contracts/lightingChannelsAbi.ts'

/** The bits of the word the channels take (`MOBILITY_CHANNELS_SHIFT`). */
const MOBILITY_CHANNELS = ALL_LIGHTING_CHANNELS_MASK << MOBILITY_CHANNELS_SHIFT

// The object's lighting channels reach the word as the object holds them (stored: zero is the
// default), in the three bits a light's maps read the placement's channels by; a change of them
// stales the pages the placement is drawn in.
test('a placement’s lighting channels reach its word, stored, apart from the other bits', () => {
  const channels = { channel0: false, channel1: true, channel2: true }
  const bits = storedChannelsOf(channels) << PLACEMENT_CHANNELS_SHIFT
  const word = castFlagsOf({}, { evaluate: true, bits } as never)
  assert.equal((word & MOBILITY_CHANNELS) >>> MOBILITY_CHANNELS_SHIFT, storedChannelsOf(channels))
  assert.equal(
    word & ~MOBILITY_CHANNELS,
    castFlagsOf({}, { evaluate: true } as never),
    'no other bit',
  )
  assert.equal(castFlagsOf({}, {} as never) & MOBILITY_CHANNELS, 0, 'the default: no bit')
  assert.equal(MOBILITY_CHANNELS & (1 << 11), 0, 'bit 11 is another’s')
  assert.equal(
    MOBILITY_CAST_BITS & MOBILITY_CHANNELS,
    MOBILITY_CHANNELS,
    'a change stales the pages',
  )
})

// The arrivals are one set of bits the diff's state per view reads, kept by the mobility until the
// state ran over them; no write of the diff's memory is made a rank.
test('the ranks that arrived are one set the diff reads, then clears', () => {
  const { rt, writes, upload } = rootWordsTwin(40)
  const { mobility } = rt.lights
  assert.equal(mobility.hasArrivals(), false, 'none before an upload')
  upload()
  assert.equal(mobility.hasArrivals(), true)
  assert.deepEqual(
    [...mobility.arrivals.subarray(0, 2)],
    [0xffffffff, 0xff],
    'every placement of the layout arrived',
  )
  const written = writes.length
  upload()
  assert.equal(writes.length, written, 'a still upload writes nothing')
  assert.equal(mobility.hasArrivals(), true, 'kept until the diff ran')
  mobility.clearArrivals()
  assert.equal(mobility.hasArrivals(), false)
  assert.ok(mobility.arrivals.every((word) => word === 0))
})

// The buffer the diff reads holds the words that changed alone: the whole set to a buffer made anew,
// then the words set or cleared since the last send.
test('the arrivals are sent by the words that changed', () => {
  const mobility = createShadowMobility()
  mobility.ensure(200, () => new Float64Array(16))
  const write = () => mobility.writeRoots(() => {}, { castFlags: () => 0 })
  const sent: [number, number[]][] = []
  const send = (whole: boolean) =>
    mobility.sendArrivals(whole, (first, words) => sent.push([first, [...words]]))
  write()
  send(true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]![0], 0)
  assert.equal(sent[0]![1].length, 7, 'the words of 200 ranks')
  send(false)
  assert.equal(sent.length, 1, 'nothing changed: nothing sent')
  // The state ran: the words that held bits go down as zeros with the next send, and a rank that
  // returns lands in its own.
  mobility.clearArrivals()
  mobility.park(70)
  mobility.touch(70)
  write()
  send(false)
  assert.deepEqual(sent[1], [0, [0, 0, 0x40, 0, 0, 0, 0]])
})
