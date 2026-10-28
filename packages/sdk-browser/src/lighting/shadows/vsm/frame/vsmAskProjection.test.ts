// The per-light projection's pipeline is asked at a frame's entry (`askPerLightLights`), not only
// when the pass encodes: only a scene with a shadowed local light on the per-light path asks it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { pipelinesSettled } from '../../../deferred/compileLedger.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { perLightPipelinesOf } from '../projection/perLightPipelines.ts'
import { pipelinesFor } from '../projection/projectionPipelines.ts'
import { createVsmResources } from '../resources.ts'
import { askPerLightLights } from './vsmAskProjection.ts'

/** Whether the per-light projection is compiled once `askPerLightLights` ran for a scene of
 *  `shadowedLocals` shadowed local lights, the one-pass projection on or off. */
async function compiledAfterAsk(shadowedLocals: number, onePass: boolean, shadowQuality = 1) {
  const fake = fakeDevice({ limits: { maxStorageBuffersPerShaderStage: 10 } })
  const res = createVsmResources(fake.device, { coverMode: 'suns', fullMapCapacity: 7 })
  const rt = {
    context: { shadowOnePassProjection: onePass, shadowQuality },
    // No lit program on this runtime: the guard and the projection's pipeline are what the test reads.
    gpu: { deferred: undefined },
    lights: { vsm: { res }, store: { shadowedLocals, unlit: false } },
  } as unknown as WebgpuPagesRuntime
  const projection = perLightPipelinesOf(pipelinesFor(fake.device, res.layout)).projection
  // `ready`, not `get()`: a `get()` of a pipeline nothing asked asks it.
  assert.equal(projection.ready, false, 'not compiled before')
  askPerLightLights(rt, fake.device)
  await pipelinesSettled(fake.device)
  return projection.ready
}

test('a shadowed local light on the per-light path asks the projection pipeline at the frame’s entry', async () => {
  assert.equal(await compiledAfterAsk(2, false), true)
})

test('no shadowed local light, or the one-pass projection, asks nothing', async () => {
  assert.equal(await compiledAfterAsk(0, false), false)
  assert.equal(await compiledAfterAsk(2, true), false)
})

test('the shadows off, the per-light path asks nothing: one guard for the projection and the lit program', async () => {
  assert.equal(await compiledAfterAsk(2, false, 0), false)
})
