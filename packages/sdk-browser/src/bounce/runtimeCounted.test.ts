// Every ray of the run-time proxy is cast in its frame: the opaque trace keeps no answer from one image to
// the next and no frame budget cuts a ray. The shipped WGSL run as JavaScript: each ray answers what it meets,
// and its work joins the frame's counter once its workgroup shares it (`rtShare`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { TRACE_LIST } from './runtimeLayout.ts'
import { along, ahead, counters, origin, runOver } from './runtimeRun.fixture.ts'
import { world } from './runtimeScene.fixture.ts'
import { TRACE_SHADER } from '../reflections/trace.ts'

const lit = () => world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })

test('the trace binds no store of answers and reads no frame budget', () => {
  for (const gone of ['rtStore', 'rtAnswer', 'RT_FRAME_WORK', 'reflectionView.runtime', 'RT_LEFT'])
    assert.ok(!TRACE_SHADER.includes(gone), gone)
  assert.ok(TRACE_SHADER.includes('rtCounted('), 'the proxy stage casts its ray')
})

test('every ray is cast and answers what it meets, its work joining the frame once shared', () => {
  const list = counters(0),
    run = runOver(lit(), list)
  const seen = run.rtCounted(origin, ahead, 1000, 0.01)
  const base = run.testWork()
  // The clear coat's lobe, a second ray of the same pixel: cast as well, never left unanswered.
  const coat = run.rtCounted(origin, ahead, 1000, 0.01)
  assert.deepEqual([seen.color, seen.confidence], [[3, 2, 1], 1])
  assert.deepEqual([coat.color, coat.confidence], [[3, 2, 1], 1])
  assert.equal(list[TRACE_LIST.spent], 0, 'nothing reaches the frame before the share')
  run.testShare()
  assert.equal(list[TRACE_LIST.spent], 2 * base, 'both rays counted')
})

test('a scene with no placement wearing a proxy casts nothing and counts nothing', () => {
  const w = world(1, 1, { places: along(1, 4) })
  w.header.instances = 0
  const list = counters(0),
    run = runOver(w, list)
  assert.equal(run.rtCounted(origin, ahead, 1000, 0.01).confidence, 0)
  run.testShare()
  assert.deepEqual(list, counters(0))
})
