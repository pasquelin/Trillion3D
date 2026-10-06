// A held frame redisplays the previous frame's target. It still published the draw counters and
// the step durations of the last full render, i.e. work it had not done. It now publishes the
// present alone, and leaves intact the metrics of the cut it redisplays.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CPU_STEP, CPU_STEP_NAMES } from '../pages/render/cpuStepTable.ts'
import { holdWebgpuFrame } from './hold.ts'
import { metricsOf } from '../pages/io/metrics.ts'
import { heldFrame } from './holdMetrics.fixture.ts'

test('a held frame counts only its present, not the last full render', () => {
  const { rt, run, timing, device } = heldFrame()
  assert.equal(holdWebgpuFrame(rt, device), true, 'the frame should have been held')
  assert.equal(run.frameHeld, true)
  assert.equal(run.gpuDrawCalls, 1, 'the present is the only draw call')
  assert.equal(run.blendDrawCalls, 0)
  assert.deepEqual([run.submittedTriangles, run.blendSubmittedTriangles], [0, 0], 'no triangle')
  assert.equal(run.cpuSelectMs, null, 'no CPU cut ran')
  assert.deepEqual([timing.lastGpuPassMs, timing.lastGpuFrameMs], [null, null], 'no pass timed')
  assert.equal(timing.lastGpuHostGapMs, null)
})

test('step durations of a held frame describe only the present', () => {
  const { rt, timing, device } = heldFrame()
  holdWebgpuFrame(rt, device)
  const row = timing.cpuProfile.row
  const presentation = new Set([
    CPU_STEP.queueSubmitMs,
    CPU_STEP.encodeSubmitMs,
    CPU_STEP.submitMs,
    CPU_STEP.totalMs,
  ])
  const unmeasured = new Set([CPU_STEP.tilesPumpMs])
  for (let i = 0; i < row.length; i++)
    if (unmeasured.has(i)) assert.ok(Number.isNaN(row[i]), `${CPU_STEP_NAMES[i]} not run`)
    else if (!presentation.has(i)) assert.equal(row[i], 0, `${CPU_STEP_NAMES[i]} not executed`)
  assert.equal(timing.rowFilled, true, 'the held-frame row is deposited')
  assert.equal(timing.cpuSample, undefined, 'the detailed sample of another frame is dropped')
})

test('metrics of the redisplayed cut do not move', () => {
  const { rt, run, device } = heldFrame()
  holdWebgpuFrame(rt, device)
  const metrics = metricsOf(rt)
  assert.equal(metrics.frameHeld, true)
  assert.equal(metrics.clusters, 800, 'the redisplayed cut is the same')
  const { selectedTriangles, frustumRejected, lodLevel } = metrics
  assert.deepEqual([selectedTriangles, frustumRejected, lodLevel], [123456, 29987, 2])
  assert.equal(metrics.drawCalls, 1)
  assert.equal(metrics.submittedTriangles, 0)
  assert.equal(run.frame, 6, 'a frame was produced')
})
