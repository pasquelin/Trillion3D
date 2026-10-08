// A pass stream whose commands repeat is recorded once as a render bundle and replayed while its
// key — the layout, then every object and number the commands name — is the one recorded; the
// latest `capacity` keys are held, so a stream that alternates between two inputs replays both.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { replayBundles } from '../../../../../tests/kit/gpu/fakeBundles.ts'
import { RenderBundles, type RecordBundle } from './renderBundles.ts'

const LAYOUT: GPURenderBundleEncoderDescriptor = { label: 'stream', colorFormats: ['r32uint'] }

/** Draws the key's buffer at each offset it lists after it. */
const record: RecordBundle = (encoder, key) => {
  for (let at = 2; at < key.length; at++)
    encoder.drawIndirect(key[1] as GPUBuffer, key[at] as number)
}

/** A pass that records the offsets its bundles draw, and how many bundle lists it executed. */
function pass() {
  const drawn: number[] = []
  let executed = 0
  const target = {
    drawIndirect: (_: GPUBuffer, offset: number) => void drawn.push(offset),
    executeBundles(bundles: GPURenderBundle[]) {
      executed++
      replayBundles(target, bundles)
    },
  }
  return { pass: target as unknown as GPURenderPassEncoder, drawn, executed: () => executed }
}

test('a key held replays its bundle; one that moves records once more', () => {
  const { device, bundles } = fakeDevice()
  const stream = new RenderBundles(1),
    buffer = {} as GPUBuffer,
    into = pass()
  const frame = (...offsets: number[]) => {
    stream.keyed(LAYOUT).push(buffer, ...offsets)
    stream.execute(into.pass, device, record)
  }
  frame(0, 16)
  frame(0, 16)
  assert.equal(bundles.length, 1, 'recorded by the first frame alone')
  assert.equal(into.executed(), 2, 'one call a frame')
  assert.deepEqual(into.drawn, [0, 16, 0, 16], 'each frame draws the stream')
  assert.equal(bundles[0].descriptor, LAYOUT, 'recorded for the layout the key opens with')
  frame(0, 32)
  assert.equal(bundles.length, 2, 'an offset that moved records')
  stream.keyed({ ...LAYOUT }).push(buffer, 0, 32)
  stream.execute(into.pass, device, record)
  assert.equal(bundles.length, 3, 'so does another layout')
})

test('two keys held: a stream alternating between two inputs records each once', () => {
  const { device, bundles } = fakeDevice()
  const stream = new RenderBundles(2),
    [a, b, c] = [{}, {}, {}] as GPUBuffer[],
    into = pass()
  const frame = (buffer: GPUBuffer) => {
    stream.keyed(LAYOUT).push(buffer, 0)
    stream.execute(into.pass, device, record)
  }
  for (let i = 0; i < 4; i++) frame(i % 2 ? b : a)
  assert.equal(bundles.length, 2)
  // A third input takes the place of the one least recently drawn.
  frame(c)
  frame(b)
  assert.equal(bundles.length, 3, 'the latest two are held')
  frame(a)
  assert.equal(bundles.length, 4, 'the oldest was forgotten')
  stream.clear()
  frame(a)
  assert.equal(bundles.length, 5, 'nothing is held after `clear`')
})

// A key may name what decides a stream rather than the stream: the recording walks it, and what
// it notes comes back on every replay; a walk that found an input not ready yet is forgotten.
test('a replay gives back what its recording noted; a bundle forgotten is recorded again', () => {
  const { device, bundles } = fakeDevice()
  const stream = new RenderBundles(2),
    into = pass()
  let walks = 0
  const walk: RecordBundle = (encoder) => (encoder.drawIndirect({} as GPUBuffer, 0), ++walks)
  const frame = () => (stream.keyed(LAYOUT).push(7), stream.execute(into.pass, device, walk))
  assert.deepEqual([frame(), frame()], [1, 1], 'the note of the one walk')
  stream.forgetLatest()
  assert.deepEqual([frame(), frame()], [2, 2], 'walked again once forgotten')
  assert.equal(bundles.length, 2)
})
