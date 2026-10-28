// The projection's programs of the classic shadows (`shadowVirtualEnable` off): the trace is one filtered read of the dense maps (`vsmClassicShadow`), none of the soft rays', and the
// virtual maps' programs are what they were. The cascades' and the biases' words are the view's (`classicView.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmLayout } from '../vsm/layout.ts'
import { vsmLocalsProjectionWgsl, vsmSunsProjectionWgsl } from '../vsm/projection/projectionWgsl.ts'

const options = { coverMode: 'suns' as const, fullMapCapacity: 127, sunMapCapacity: 35 }

test('a classic layout traces by the filter, a virtual one by the rays', () => {
  const classic = vsmLayout({ ...options, classic: true })
  assert.equal(classic.classic, true)
  assert.equal(vsmLayout(options).classic, false)
  for (const code of [
    vsmSunsProjectionWgsl(classic),
    vsmLocalsProjectionWgsl(classic, 'rg32uint'),
  ]) {
    assert.ok(code.includes('fn vsmClassicShadow('))
    assert.ok(
      code.includes('result.shadowFactor=vsmClassicShadow(light,P,n,axis,dist,directional);'),
    )
    assert.ok(!code.includes('vsmRayNoise4(pixel.pos'), 'no soft ray is cast')
  }
  const virtual = vsmSunsProjectionWgsl(vsmLayout(options))
  assert.ok(!virtual.includes('vsmClassicShadow'))
  assert.ok(virtual.includes('vsmRayNoise4(pixel.pos'))
})
