// A subsurface receiver lets a share of its light through its shadow (`vsmSubsurfaceShadow`): where
// the trace was shadowed, the light that travels the mean distance its rays were stopped at through
// the material, e^(−distance · density) with the density of the opacity (−0.05 · ln(1 − opacity) per
// centimetre), added to the share the rays missed, then squared.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { VSM_CM_PER_UNIT } from '../constants.ts'
import { PROJECTION_CODE as CODE } from './projectionRun.fixture.ts'

type Trace = { shadowFactor: number; rayCount: number; occluderDistance: number }
type Info = {
  valid: boolean
  subsurface: boolean
  worldNormal: number[]
  opacity: number
  toon?: boolean
  extinction?: number
}
const { vsmSubsurfaceShadow } = shaderRun<{
  vsmSubsurfaceShadow: (r: Trace, info: Info) => Trace
}>(CODE, ['vsmSubsurfaceShadow'], {})
const info = (opacity: number): Info => ({
  valid: true,
  subsurface: opacity >= 0,
  worldNormal: [0, 0, 1],
  opacity,
})

test('a receiver with no subsurface, or a trace that was not shadowed, is left as it is', () => {
  const shadowed: Trace = { shadowFactor: 0.25, rayCount: 4, occluderDistance: 0.5 }
  assert.deepEqual(vsmSubsurfaceShadow(shadowed, info(-1)), shadowed)
  const lit: Trace = { shadowFactor: 1, rayCount: 4, occluderDistance: 0.5 }
  assert.deepEqual(vsmSubsurfaceShadow(lit, info(0.5)), lit)
  const none: Trace = { shadowFactor: 1, rayCount: 0, occluderDistance: -1 }
  assert.deepEqual(vsmSubsurfaceShadow(none, info(0.5)), none)
})

test('the light through the material follows the distance, the opacity and the share missed', () => {
  for (const [opacity, distance, missed] of [
    [0.5, 0.01, 0],
    [0.5, 0.2, 0.25],
    [0.99, 0.05, 0.5],
    [0.1, 1, 0],
  ]) {
    const r = vsmSubsurfaceShadow(
      { shadowFactor: missed, rayCount: 4, occluderDistance: distance },
      info(opacity),
    )
    const density = -0.05 * Math.log(1 - opacity)
    const transmission = Math.min(1, Math.exp(-distance * VSM_CM_PER_UNIT * density))
    const through = transmission + (1 - transmission) * missed
    assert.ok(Math.abs(r.shadowFactor - through * through) < 1e-5, `${opacity} ${distance}`)
  }
})

test('a toon receiver lets through the light its profile’s extinction leaves over the occluder distance', () => {
  for (const [extinction, distance, missed] of [
    [0.1, 0.01, 0],
    [0.1, 0.2, 0.25],
    [0.5, 0.05, 0.5],
    [0, 1, 0],
  ]) {
    const r = vsmSubsurfaceShadow(
      { shadowFactor: missed, rayCount: 4, occluderDistance: distance },
      { ...info(0), toon: true, extinction },
    )
    const transmission = Math.min(1, Math.exp(-distance * VSM_CM_PER_UNIT * extinction))
    const through = transmission + (1 - transmission) * missed
    assert.ok(Math.abs(r.shadowFactor - through * through) < 1e-5, `${extinction} ${distance}`)
  }
})
