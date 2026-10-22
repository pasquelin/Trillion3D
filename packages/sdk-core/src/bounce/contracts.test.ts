import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_PROBE_QUEUE, BOUNCE_SETTINGS, resolveProbesPerFrame } from './contracts.ts'

test('a frame queues as many probes as the ray ceiling holds, and no more', () => {
  const { raysPerProbe, raysPerFrame } = BOUNCE_SETTINGS
  assert.ok(Number.isInteger(BOUNCE_PROBE_QUEUE) && BOUNCE_PROBE_QUEUE >= 1)
  assert.ok(BOUNCE_PROBE_QUEUE * raysPerProbe <= raysPerFrame, 'within the ceiling')
  assert.ok((BOUNCE_PROBE_QUEUE + 1) * raysPerProbe > raysPerFrame, 'one more would pass it')
})

test('the probes a frame traces: the default when none is asked, a whole count within the queue otherwise', () => {
  assert.equal(resolveProbesPerFrame(undefined), BOUNCE_SETTINGS.probesPerFrame)
  assert.ok(BOUNCE_SETTINGS.probesPerFrame <= BOUNCE_PROBE_QUEUE)
  assert.equal(resolveProbesPerFrame(1), 1)
  assert.equal(resolveProbesPerFrame(BOUNCE_PROBE_QUEUE), BOUNCE_PROBE_QUEUE)
  for (const asked of [0, -3, 1.5, NaN, Infinity, BOUNCE_PROBE_QUEUE + 1])
    assert.throws(() => resolveProbesPerFrame(asked), RangeError, `${asked}`)
})
