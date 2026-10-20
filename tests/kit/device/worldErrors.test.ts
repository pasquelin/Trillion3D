// The world devices' listener hooks the page's WebGPU once a process: a family proof draws every case
// in one process, and each case asks for it again (`runtimeFamilyPage.ts`); each case's devices fill
// that case's lists alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { listenToWorldDevices } from './worldErrors.ts'

test('every case listens through one hook, each device filling its own case’s lists', async () => {
  const device = () => ({
    addEventListener() {},
    createBuffer: (descriptor: GPUBufferDescriptor) => ({ label: descriptor.label }),
    createTexture: (descriptor: GPUTextureDescriptor) => ({ label: descriptor.label }),
  })
  const gpu = {
    requestAdapter: async () => ({ requestDevice: async () => device() }),
  }
  Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true })
  try {
    const cases = []
    for (let caseIndex = 0; caseIndex < 3; caseIndex++) {
      const listened = listenToWorldDevices()
      const made = await (await navigator.gpu.requestAdapter())!.requestDevice()
      made.createBuffer({ label: `buffer ${caseIndex}`, size: 4, usage: 0 })
      cases.push(listened)
    }
    cases.forEach(({ made }, caseIndex) =>
      assert.deepEqual([...made.keys()], [`buffer ${caseIndex}`]),
    )
  } finally {
    Reflect.deleteProperty(globalThis.navigator, 'gpu')
  }
})
