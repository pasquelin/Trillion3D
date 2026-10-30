// The bounce's lit program compiles beside the probes' rigging: asked from what the bounce wants, before the grid it reads exists.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredLighting } from '../../lighting/deferred/deferred.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { deferredLightingHarness } from './hold.fixture.ts'

installGpuGlobals()

test('asking the bounce program starts its compile with no probe grid, and the program a grid asks later is that one', async () => {
  const h = deferredLightingHarness()
  const started: string[] = []
  const compile = h.device.createRenderPipelineAsync.bind(h.device)
  h.device.createRenderPipelineAsync = (descriptor) => (
    started.push(descriptor.fragment?.module.label ?? ''),
    compile(descriptor)
  )
  const lighting = await createDeferredLighting(h.device, () => {})
  const direct = { lights: {} as GPUBuffer }
  const before = started.filter((label) => label.startsWith('BOUNCE')).length
  lighting.askBounce(direct)
  // The program is built off the frame: its pipeline is asked a few tasks later.
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(
    started.filter((label) => label.startsWith('BOUNCE')).length > before,
    'the bounce variant compiles at once, with no grid',
  )
  const asked = started.length
  const pending = lighting.awaited({ ...direct, bounceGrid: {} as GPUBuffer })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(started.length, asked, 'a grid asking the same program starts no second compile')
  h.finishCompilation()
  await pending
})

test('asking the bounce program warms the one with no toon data too, where the decision says toon', async () => {
  const h = deferredLightingHarness()
  const started: string[] = []
  const compile = h.device.createRenderPipelineAsync.bind(h.device)
  h.device.createRenderPipelineAsync = (descriptor) => (
    started.push(descriptor.fragment?.module.label ?? ''),
    compile(descriptor)
  )
  const lighting = await createDeferredLighting(h.device, () => {})
  lighting.askBounce({ lights: {} as GPUBuffer, toonUnified: true })
  await new Promise((resolve) => setImmediate(resolve))
  const bounce = started.filter((label) => label.startsWith('BOUNCE'))
  assert.ok(
    bounce.some((label) => !label.includes('TOON')),
    'the program bounceReady reads',
  )
  assert.ok(
    bounce.some((label) => label.includes('TOON')),
    'and the toon table’s',
  )
  h.finishCompilation()
})
