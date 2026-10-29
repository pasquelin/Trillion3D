// When a reflection capture is captured (`schedule.ts`): on add, on the point or the face settings changing, never on a brightness change.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { REFLECTION_CAPTURE_RULES } from '../../../../sdk-core/src/contracts/reflectionCaptureOptions.ts'
import { resolveReflectionCapture } from '../../../../sdk-core/src/scene/reflectionCapture/contracts.ts'
import { captureKey, lookAtCaptures, recaptureAll, type CaptureHeld } from './schedule.ts'

const settings = resolveSettings(REFLECTION_CAPTURE_RULES, {})
const R = resolveReflectionCapture
const at = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]
const done = (held: Map<string, CaptureHeld>, key: (id: string) => string) => {
  for (const [id, h] of held) {
    h.key = key(id)
    h.done = true
  }
}

test('a new capture is due and takes the lowest free layer, a removed one frees its layer', () => {
  const held = new Map<string, CaptureHeld>()
  const a = R({ id: 'a' }),
    b = R({ id: 'b' })
  assert.deepEqual(
    lookAtCaptures(held, [a, b], settings, 4).map((c) => c.id),
    ['a', 'b'],
  )
  assert.deepEqual([held.get('a')!.layer, held.get('b')!.layer], [0, 1])
  lookAtCaptures(held, [b], settings, 4)
  assert.equal(held.has('a'), false)
  lookAtCaptures(held, [b, R({ id: 'c' })], settings, 4)
  assert.equal(held.get('c')!.layer, 0)
})

test('a capture past the capacity is not held', () => {
  const held = new Map<string, CaptureHeld>()
  const due = lookAtCaptures(held, [R({ id: 'a' }), R({ id: 'b' })], settings, 1)
  assert.deepEqual(
    due.map((c) => c.id),
    ['a'],
  )
  assert.equal(held.has('b'), false)
})

test('a moved point or another face setting asks a capture again; a brightness asks none', () => {
  const held = new Map<string, CaptureHeld>()
  const a = R({ id: 'a', matrix: at(0) })
  lookAtCaptures(held, [a], settings, 2)
  done(held, () => captureKey(a, settings))
  const due = (c: typeof a, s = settings) => lookAtCaptures(held, [c], s, 2).length
  assert.equal(due(a), 0)
  assert.equal(
    due(R({ id: 'a', matrix: at(0), brightness: 3, influenceRadius: 5 })),
    0,
    'the records only',
  )
  assert.equal(due(R({ id: 'a', matrix: at(2) })), 1, 'moved')
  assert.equal(due(R({ id: 'a', matrix: at(0), captureOffset: [0, 1, 0] })), 1, 'offset')
  assert.equal(
    due(a, resolveSettings(REFLECTION_CAPTURE_RULES, { reflectionCaptureResolution: 64 })),
    1,
    'side',
  )
  assert.equal(
    due(a, resolveSettings(REFLECTION_CAPTURE_RULES, { reflectionCaptureSupersample: 2 })),
    1,
  )
  recaptureAll(held)
  assert.equal(due(a), 1, 'asked by the host')
})
