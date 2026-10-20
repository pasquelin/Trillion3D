import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stepsOf, type Variant } from './dissectReport.ts'

const v = (cut: string | null, frameMs: number, passMs: number): Variant => ({
  cut,
  frameMs,
  passMs,
  iqrMs: 0.02,
})

test('the cost of each step is the difference between its cut and the one before', () => {
  // A shader built to cost 0.1 ms to launch, 1 ms to decode, 0.2 ms to classify, 3 ms to trace.
  const { steps, driftMs } = stepsOf(
    ['launch', 'decode', 'classify'],
    [
      v(null, 14.3, 4.3),
      v('launch', 10.1, 0.1),
      v('decode', 11.1, 1.1),
      v('classify', 11.3, 1.3),
      v(null, 14.3, 4.3),
    ],
  )
  assert.deepEqual(
    steps.map((s) => s.to),
    ['launch', 'decode', 'classify', 'end'],
  )
  assert.ok(Math.abs(steps[1].passMs - 1) < 1e-9 && Math.abs(steps[2].passMs - 0.2) < 1e-9)
  assert.ok(
    Math.abs(steps[3].passMs - 3) < 1e-9,
    'the trace is what the whole costs beyond the last cut',
  )
  assert.equal(driftMs, 0)
  assert.equal(steps[2].noise, false)
})

test('a step smaller than the drift between the two whole runs is called noise', () => {
  const { steps } = stepsOf(
    ['a', 'b'],
    [v(null, 12, 2), v('a', 10, 0.1), v('b', 10.05, 0.15), v(null, 12.2, 2.2)],
  )
  assert.equal(steps[1].noise, true, '0.05 ms is under the 0.2 ms the machine drifted')
  assert.equal(steps[2].noise, false)
})

test('a machine that drifts in the middle shows in the whole runs between the cuts', () => {
  const { driftMs, steps } = stepsOf(
    ['a', 'b'],
    [v(null, 12, 2), v('a', 10, 0.1), v(null, 12.6, 2.6), v('b', 10.4, 0.5), v(null, 12, 2)],
  )
  assert.ok(Math.abs(driftMs - 0.6) < 1e-9, 'the ends agree, the middle does not')
  assert.equal(steps[1].noise, true, 'a 0.4 ms step under a 0.6 ms drift is noise')
})
