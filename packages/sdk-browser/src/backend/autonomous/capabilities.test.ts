import test from 'node:test'
import assert from 'node:assert/strict'
import { autonomousCapabilities, publishAutonomousCapabilities } from './capabilities.ts'

// #337: the WebGL2 page path draws blended and transmissive surfaces as whole scene copies; its
// declaration names them among what it renders, never among what it does not.
test('the WebGL2 page path declares the blend and transmission it draws', () => {
  const { materials, unsupported } = autonomousCapabilities(false)
  assert.match(materials, /blended/)
  assert.match(materials, /transmission/)
  assert.ok(!unsupported.some((entry) => /BLEND|transmission/.test(entry)))
})

// #363: WebGL2 has no temporal antialiasing; `world.temporalAntialiasing` reads false there.
test('the WebGL2 page path declares temporal antialiasing unsupported', () => {
  assert.ok(autonomousCapabilities(false).unsupported.includes('temporal antialiasing'))
})

// #832, #834: nor temporal upscaling: WebGL2 honours `renderScale` by a spatial resample only.
test('the WebGL2 page path declares temporal upscaling unsupported', () => {
  assert.ok(autonomousCapabilities(false).unsupported.includes('temporal upscaling'))
})

// #839: what WebGL2 cannot carry reaches the diagnostics by name, as WebGPU publishes its own.
test('the WebGL2 page path publishes each declared degradation', () => {
  const heard: { phase: string; context?: Record<string, unknown> }[] = []
  publishAutonomousCapabilities((diagnostic) => heard.push(diagnostic))
  const { unsupported } = autonomousCapabilities(false)
  assert.deepEqual(
    heard.map(({ phase }) => phase),
    ['render-capabilities'],
  )
  assert.deepEqual(heard[0].context?.unsupported, unsupported)
  assert.ok(['cast shadows', 'occlusion culling'].every((lost) => unsupported.includes(lost)))
})
