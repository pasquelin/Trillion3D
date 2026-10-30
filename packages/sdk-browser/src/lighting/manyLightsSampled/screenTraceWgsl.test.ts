import test from 'node:test'
import assert from 'node:assert/strict'
import { SCREEN_TRACE_ENTRY, screenTraceWgsl } from './screenTraceWgsl.ts'
import { LIGHT_TRACE_WGSL } from './lightTraceWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

test('the screen trace marches the engine’s pyramid and writes the samples in place', () => {
  const code = screenTraceWgsl()
  assert.ok(code.includes(`fn ${SCREEN_TRACE_ENTRY}(`))
  assert.ok(code.includes('fn screenMarch('), 'the shared march, not a copy')
  assert.ok(code.includes('fn lightSampleTrace('))
})

test('every kind of light has a segment', () => {
  const code = wgslModule(LIGHT_TRACE_WGSL)
  for (const kind of ['isSun(light)', 'isRect(light)', 'tubeHalfLengthOf(light)'])
    assert.ok(code.includes(kind), kind)
})

test('the software trace marches the global field from where the screen left the ray', async () => {
  const { SOFTWARE_TRACE_ENTRY, softwareTraceWgsl } = await import('./softwareTraceWgsl.ts')
  const code = softwareTraceWgsl(false)
  assert.ok(code.includes(`fn ${SOFTWARE_TRACE_ENTRY}(`))
  assert.ok(code.includes('fn gdfTrace('), 'the engine’s march, not a copy')
  assert.ok(code.includes('lightSampleRayDistance(ray)'))
})

test('the screen trace of several closures offsets its rays along the normal of the closure the pixel is lit as; one closure keeps the text', () => {
  const several = screenTraceWgsl(true)
  assert.ok(
    several.includes('let N=normalize(textureLoad(colours,pixel,pickedNormalLayer(pixel),0).xyz);'),
  )
  assert.ok(several.includes('var blueNoiseMask'), 'the blue noise the pick reads')
  assert.ok(several.includes('fn pickedClosure('))
  const one = screenTraceWgsl()
  assert.ok(!/pickedClosure|blueNoiseMask|closuresHeld/.test(one))
  assert.equal(one, screenTraceWgsl(false))
})
