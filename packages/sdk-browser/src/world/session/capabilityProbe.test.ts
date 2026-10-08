import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineError, type RuntimeEvent } from '../../../../sdk-core/src/index.ts'
import { probeExplorerCapabilities } from './capabilityProbe.ts'
import { WEBGPU_REQUIRED_WGSL_FEATURES } from '../../engine/common.ts'

/** The WGSL language features of a browser that compiles every engine program. */
const wgslLanguageFeatures = new Set<string>(WEBGPU_REQUIRED_WGSL_FEATURES)
import type { ExplorerSession } from './session.ts'

/** A session on a machine whose `navigator.gpu` is `gpu`, its events and diagnostics kept. */
function session(gpu: GPU | undefined) {
  const events: RuntimeEvent[] = [],
    phases: string[] = []
  const opened = {
    options: { manifestUrl: '', gpu },
    scope: 'full',
    emit: (event: RuntimeEvent) => void events.push(event),
    diagnose: (phase: string) => void phases.push(phase),
  } as unknown as ExplorerSession
  return { opened, events, phases }
}

test('a browser without WebGPU gets the fatal WEBGPU_UNAVAILABLE, with a clear message', async () => {
  for (const gpu of [
    undefined,
    { wgslLanguageFeatures, requestAdapter: async () => null } as unknown as GPU,
    { wgslLanguageFeatures: new Set(), requestAdapter: async () => null } as unknown as GPU,
  ]) {
    const { opened, events, phases } = session(gpu)
    await assert.rejects(
      probeExplorerCapabilities(opened),
      (error: unknown) =>
        error instanceof EngineError &&
        error.code === 'WEBGPU_UNAVAILABLE' &&
        /draws with WebGPU only/.test(error.message) &&
        /browser with WebGPU enabled/.test(error.message),
    )
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'fatal')
    assert.equal(events[0].code, 'WEBGPU_UNAVAILABLE')
    assert.equal(events[0].recovered, false)
    assert.deepEqual(phases, ['error'])
  }
})

test('an adapter that refuses its device is the same fatal, naming the refusal', async () => {
  const adapter = {
    features: new Set<string>(),
    limits: {},
    requestDevice: async () => {
      throw new Error('out of devices')
    },
  }
  const { opened, events } = session({
    wgslLanguageFeatures,
    requestAdapter: async () => adapter,
  } as unknown as GPU)
  await assert.rejects(probeExplorerCapabilities(opened), /refused a device.*out of devices/)
  assert.equal(events[0].code, 'WEBGPU_UNAVAILABLE')
})

test('a device the host handed in is drawn on, and no adapter is asked', async () => {
  const device = { features: new Set(['timestamp-query']) } as unknown as GPUDevice
  const { opened, events } = session({
    wgslLanguageFeatures,
    requestAdapter: () => assert.fail('no adapter is asked'),
  } as unknown as GPU)
  opened.options.gpuDevice = device
  const probe = await probeExplorerCapabilities(opened)
  assert.equal(probe.gpuDevice, device)
  assert.equal(probe.capabilities.tier, 'full')
  assert.deepEqual(events, [])
})

test('a handed-in device under a WGSL without read-only storage textures is refused by name', async () => {
  const device = { features: new Set() } as unknown as GPUDevice
  const { opened, events } = session({ wgslLanguageFeatures: new Set() } as unknown as GPU)
  opened.options.gpuDevice = device
  await assert.rejects(
    probeExplorerCapabilities(opened),
    /lacks readonly_and_readwrite_storage_textures/,
  )
  assert.equal(events[0].code, 'WEBGPU_UNAVAILABLE')
})
