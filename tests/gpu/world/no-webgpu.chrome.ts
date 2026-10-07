// A browser without WebGPU is refused by name, in Chrome (`noWebgpuPage.ts`): a world created on
// a page whose `navigator` offers no WebGPU settles its `ready` with `WEBGPU_UNAVAILABLE`, and its
// canvas stays untouched. The WebGPU machine's default world is proved on Dawn
// (`default-world.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { inChrome } from '../kit/onChrome.ts'
import type { execute } from './noWebgpuPage.ts'

const PAGE = resolve(import.meta.dirname, 'noWebgpuPage.ts')

test('a browser without WebGPU gets WEBGPU_UNAVAILABLE', { timeout: 60_000 }, async () => {
  const read = await inChrome<Awaited<ReturnType<typeof execute>>>(PAGE, 'execute', null, {
    webgpu: false,
  })
  console.log(JSON.stringify(read))
  assert.equal(read.webgpu, false, 'the page offers WebGPU')
  assert.equal(read.code, 'WEBGPU_UNAVAILABLE', String(read.message))
  assert.equal(read.untouched, true, 'the canvas was handed out')
})
