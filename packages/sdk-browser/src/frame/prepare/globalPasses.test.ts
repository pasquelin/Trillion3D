// The passes of no light and no material are asked at the opening, from one registry; the host's explicit unlit view asks none.
import test from 'node:test'
import assert from 'node:assert/strict'
import { askGlobalPasses } from './globalPasses.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

test('the explicit unlit view asks no global pass: nothing of the runtime is read', async () => {
  const touched: string[] = []
  const trap = (name: string) => () => {
    touched.push(name)
    throw new Error(`${name} read`)
  }
  const rt = new Proxy(
    { lights: { store: { unlitAsked: true } } },
    { get: (target, key) => (key in target ? target[key as 'lights'] : trap(String(key))()) },
  ) as unknown as WebgpuPagesRuntime
  await askGlobalPasses(rt, {} as GPUDevice)
  assert.deepEqual(touched, [])
})
