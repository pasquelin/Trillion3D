// The run-time proxy's rays, the shipped WGSL run as JavaScript: they bind nothing writable, and a scene
// with no placement wearing a proxy casts nothing; the reflections' trace casts one a lobe, every image
// (`../../reflections/trace/trace.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { BINDINGS, along, ahead, origin, runOver } from './runtimeRun.fixture.ts'
import { world } from './runtimeScene.fixture.ts'
import { REFLECTION_TRACE_SHADER } from '../../reflections/trace/trace.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'

test('the proxy’s rays bind nothing writable and share no counter', () => {
  const rays = wgslModule(runtimeRadianceWgsl(BINDINGS))
  assert.ok(!rays.includes('read_write'), 'the rays write no binding')
  assert.ok(!rays.includes('atomic'), 'no counter shared between rays')
  // The reflections' trace walks it: the rays' own module, no other copy of the walk.
  assert.ok(REFLECTION_TRACE_SHADER.includes('fn rtLayers('), 'the trace walks the one proxy walk')
})

test('a scene with no placement wearing a proxy casts nothing', () => {
  const w = world(1, 1, { places: along(1, 4) })
  w.header.instances = 0
  const run = runOver(w)
  const seen = run.rtRadiance(origin, ahead, 1000, 0.01)
  assert.deepEqual([seen.color, seen.confidence], [[0, 0, 0], 0])
  assert.equal(run.testWork(), 0, 'no ray walked')
})
