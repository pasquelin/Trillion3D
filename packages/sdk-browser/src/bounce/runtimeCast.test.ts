// Every ray of the run-time proxy is cast in its frame: the opaque trace keeps no answer from one image to
// the next, no frame budget cuts a ray, and nothing counts its work in the kernel — what it costs is the
// frame's GPU duration, which the proxy budget observes. The shipped WGSL run as JavaScript.
import test from 'node:test'
import assert from 'node:assert/strict'
import { along, ahead, origin, runOver } from './runtimeRun.fixture.ts'
import { world } from './runtimeScene.fixture.ts'
import { TRACE_SHADER } from '../reflections/trace.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'

const lit = () => world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })

test('the trace binds no store of answers, reads no frame budget and counts no work', () => {
  for (const gone of [
    'rtStore',
    'rtAnswer',
    'RT_FRAME_WORK',
    'reflectionView.runtime',
    'RT_LEFT',
    'rtShare',
    'rtSpentHere',
    'rtGroupSpent',
    // A placement's instance is read once, whole, never a texel load a word.
    'rtInstanceWord',
  ])
    assert.ok(!TRACE_SHADER.includes(gone), gone)
  assert.ok(TRACE_SHADER.includes('let seen=rtRadiance('), 'the proxy stage casts its ray')
})

test('the proxy’s rays bind nothing writable: the trace declares its own list, one ray function', () => {
  const rays = wgslModule(runtimeRadianceWgsl({ group: 0, proxy: 12, worlds: 13, tree: 14 }))
  assert.ok(!rays.includes('read_write'), 'the rays write no binding')
  assert.ok(!TRACE_SHADER.includes('rtCast'), 'no second entry beside rtRadiance')
  assert.ok(TRACE_SHADER.includes('var<storage,read_write> traceList:array<atomic<u32>>'))
})

test('every ray is cast and answers what it meets', () => {
  const run = runOver(lit())
  const seen = run.rtRadiance(origin, ahead, 1000, 0.01)
  // The clear coat's lobe, a second ray of the same pixel: cast as well, never left unanswered.
  const coat = run.rtRadiance(origin, ahead, 1000, 0.01)
  assert.deepEqual([seen.color, seen.confidence], [[3, 2, 1], 1])
  assert.deepEqual([coat.color, coat.confidence], [[3, 2, 1], 1])
})

test('a scene with no placement wearing a proxy casts nothing', () => {
  const w = world(1, 1, { places: along(1, 4) })
  w.header.instances = 0
  const run = runOver(w)
  const seen = run.rtRadiance(origin, ahead, 1000, 0.01)
  assert.deepEqual([seen.color, seen.confidence], [[0, 0, 0], 0])
  assert.equal(run.testWork(), 0, 'no ray walked')
})
