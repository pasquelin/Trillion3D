// The coloured transmission under the GPU budget's limit (`encodeVsmRenderAndTransmission`): a
// transmission a frame found short grows once to the capacities that frame wanted, only when the
// room holds what they add to what it frees; past it it is capped, said once, never asked of the
// device, and the maps no longer wait for it to grow.
import { nextPow2 } from '../../../../../../math/src/scalar/integers.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createVsmSettle } from '../../state/vsmSettle.ts'
import { shadowsUnsettled, type WebgpuLightState } from '../../state/lights.ts'
import { shortTransmission } from './vsmTransmission.fixture.ts'
import {
  vsmTransmissionBytes,
  VSM_TRANSMISSION_COUNTERS,
} from '../../../../vsm/transmissionLayout.ts'

test('a frame that wanted more grows once to the power of two that holds it, each capacity alone', async () => {
  const a = shortTransmission((grown, held) => grown - held)
  a.held.wanted = undefined
  const C = VSM_TRANSMISSION_COUNTERS
  const read = async (counts: Partial<Record<keyof typeof C, number>>) => {
    a.held.readFeedback({ copyBufferToBuffer() {} } as unknown as GPUCommandEncoder)
    for (const b of a.fake.buffers)
      if (b.label === 'vsm.transmission.feedback') {
        const words = new Uint32Array(b.getMappedRange())
        words.fill(0)
        for (const [k, v] of Object.entries(counts)) words[C[k as keyof typeof C]] = v
      }
    a.held.afterSubmit()
    await new Promise((settled) => setImmediate(settled))
  }
  const caps = a.first
  await read({ records: caps.records, patchWords: caps.patchWords })
  assert.equal(a.held.wanted, undefined, 'exactly held: none')
  await read({ records: 5 * caps.records + 3, blocksShort: 3 })
  const grown = a.held.wanted!
  assert.equal(grown.records, nextPow2(5 * caps.records + 3), 'one step, not doublings')
  assert.equal(grown.blocks, nextPow2(caps.blocks + 3))
  assert.equal(grown.patchWords, caps.patchWords)
})

test('a short transmission the room cannot grow is capped: said once, never asked of the device', async () => {
  const a = shortTransmission((grown, held) => grown - held - 1)
  const made = a.fake.buffers.length
  for (let frame = 0; frame < 3; frame++) assert.equal(a.frame(), a.held, `frame ${frame} keeps it`)
  assert.equal(a.held.capped, true)
  assert.equal(a.held.wanted, undefined)
  assert.equal(a.ledger.refusal, undefined)
  assert.equal(a.fake.buffers.length, made, 'nothing asked of the device')
  assert.equal(a.said.length, 1, 'said once')
  const [phase, , context] = a.said[0] as [string, string, Record<string, unknown>]
  assert.equal(phase, 'gpu-out-of-memory')
  assert.equal(context.requestedBytes, vsmTransmissionBytes(a.layout, a.wanted))
  assert.equal(context.grantedBytes, a.held.bytes)
  assert.equal(a.invalidated(), 0, 'the cached slices keep their transmission')
  // Capped, a later overflow read back no longer marks it short: the maps wait for no growth.
  for (const b of a.fake.buffers)
    if (b.label === 'vsm.transmission.feedback')
      new Uint32Array(b.getMappedRange())[VSM_TRANSMISSION_COUNTERS.records] = 1e9
  a.held.afterSubmit()
  await new Promise((settled) => setImmediate(settled))
  assert.equal(a.held.wanted, undefined)
  const vsm = { ...a.vsm, settle: createVsmSettle(), countersOn: true }
  vsm.settle.landedFrame = 0
  const lights = {
    changes: { deferred: () => false },
    store: { count: 1, unlit: false },
    vsm,
  } as unknown as WebgpuLightState
  assert.equal(shadowsUnsettled(lights), false)
  a.held.wanted = a.wanted
  assert.equal(shadowsUnsettled(lights), true, 'a short transmission still to grow is waited for')
})

test('a short transmission whose growth the room holds exactly grows to what was wanted', () => {
  const a = shortTransmission((grown, held) => grown - held)
  const held = a.ledger.bytes
  const grown = a.frame()!
  assert.deepEqual(grown.caps, a.wanted)
  assert.equal(grown.capped, false)
  assert.equal(grown.wanted, undefined)
  assert.equal(a.vsm.transmission, grown)
  assert.equal(a.ledger.refusal, undefined)
  assert.equal(
    a.ledger.bytes,
    held + vsmTransmissionBytes(a.layout, a.wanted) - vsmTransmissionBytes(a.layout, a.first),
    'the held one freed, its chunk lists kept',
  )
  assert.equal(a.said.length, 0)
  assert.equal(a.invalidated(), 1, 'the new one invalidates the world once')
})
