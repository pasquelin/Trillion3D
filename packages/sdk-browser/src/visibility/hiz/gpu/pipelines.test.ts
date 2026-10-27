import test from 'node:test'
import assert from 'node:assert/strict'
import { createHizPipelines } from './pipelines.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('the depth pyramid kernels are built with every creation under a scope, after the awaits too', async () => {
  const { device } = fakeDevice({ strictScopes: true })
  const pipelines = await createHizPipelines(device)
  assert.ok(pipelines?.buildPipeline && pipelines.fullPipeline)
})
