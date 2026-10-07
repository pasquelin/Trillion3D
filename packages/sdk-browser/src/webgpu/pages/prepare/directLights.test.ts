// The virtual shadow maps make their own pages at the first lit frame: prepare fits the light
// lists and the raster's page rows layout, and the contract lights are fitted.
import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { createWebgpuLightState } from '../state/lights.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { prepareDirectLights } from './lights.ts'

test('prepare fits the light lists and the shadow raster layout', async () => {
  const fake = fakeDevice(),
    lights = createWebgpuLightState()
  lights.buffer = {} as GPUBuffer
  const rt = {
    lights,
    context: {},
    vis: { visBindGroupLayout: {} },
    capabilities: { unsupported: ['contract scene lights with shadow atlas'] },
    diag: {
      engineDiagnostic() {},
      diagnosticFailure: (_: string, error: unknown) => assert.fail(String(error)),
    },
    signal: new AbortController().signal,
  } as unknown as WebgpuPagesRuntime
  await prepareDirectLights(rt, fake.device)
  assert.ok(lights.tiles && lights.pageLayout, 'the light lists and the raster layout')
  assert.deepEqual(rt.capabilities.unsupported, [], 'the contract lights are fitted')
})
