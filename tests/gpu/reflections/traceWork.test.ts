// The proof's trace counter hooks the page's WebGPU once a process: a family proof draws every case in
// one process, and each case asks for it again (`runtimeFamilyPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { countTraceWork } from './traceWork.ts'

const TRACE =
  'fn tracePixel(){return rtRadiance(origin,direction,reach,tangent);}\n' +
  'fn main(){tracePixel(flatIndex(wg,rows,1u),lid.xy);}'

test('every case counts the trace once: its text and its tile list hooked a single time', async () => {
  const modules: string[] = [],
    sizes: number[] = []
  const device = {
    createShaderModule: (descriptor: GPUShaderModuleDescriptor) => modules.push(descriptor.code),
    createBuffer: (descriptor: GPUBufferDescriptor) => sizes.push(descriptor.size),
  }
  const adapter = { requestDevice: async () => device }
  const gpu = { requestAdapter: async () => adapter }
  Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true })
  try {
    for (let caseIndex = 0; caseIndex < 3; caseIndex++) {
      countTraceWork()
      const granted = (await navigator.gpu.requestAdapter())!
      const made = await granted.requestDevice()
      made.createShaderModule({ code: TRACE })
      made.createBuffer({ label: 'Trillion3D reflection tile list', size: 64, usage: 0 })
    }
    for (const code of modules) assert.equal(code.split('proofShare(all(').length, 2, code)
    assert.deepEqual(sizes, [68, 68, 68], 'one counted word past the tiles')
  } finally {
    Reflect.deleteProperty(globalThis.navigator, 'gpu')
  }
})
