// The run-time proxy's rays, the shipped WGSL run as JavaScript: a ray answers what it meets and binds nothing
// writable; the reflections' trace casts one a lobe, every image (`../reflections/traceHalf.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { along, ahead, origin, runOver } from './runtimeRun.fixture.ts'
import { world } from './runtimeScene.fixture.ts'
import { REFLECTION_TRACE_SHADER } from '../reflections/traceHalf.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { runtimeRadianceWgsl } from './runtimeRadianceWgsl.ts'

const lit = () => world(1, 1, { places: along(1, 4), surfaces: [[0, 0, 0, 1, 3, 2, 1, 0]] })

test('the proxy’s rays bind nothing writable, and read a placement’s instance whole', () => {
  const rays = wgslModule(runtimeRadianceWgsl({ group: 0, proxy: 12, worlds: 13, tree: 14 }))
  assert.ok(!rays.includes('read_write'), 'the rays write no binding')
  assert.ok(!REFLECTION_TRACE_SHADER.includes('rtInstanceWord'), 'never a texel load a word')
  assert.ok(!REFLECTION_TRACE_SHADER.includes('atomic'), 'no counter shared between rays')
})

test('a ray answers what it meets, a second of the same pixel as well', () => {
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
