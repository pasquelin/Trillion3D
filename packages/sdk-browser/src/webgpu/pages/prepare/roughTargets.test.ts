import test from 'node:test'
import assert from 'node:assert/strict'
import { runtime } from './targets.fixture.ts'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { makeTargets, targetsFit } from './targets.ts'
import { frameTargetAllocation } from './targetAllocation.ts'
import { standardSurface } from '../../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../../page/surface.ts'

const native = (width: number, height: number) => ({
  width,
  height,
  renderWidth: width,
  renderHeight: height,
  apart: false,
})

/** A rough opaque receiver alone: no forward cone asked, its trace walking the depth bounds. */
function roughRuntime() {
  const { rt } = runtime(true)
  rt.layout.rows.packedRecs[0]!.material = surfaceOf(standardSurface({ roughness: 0.5 }))
  Object.assign(rt, { vis: {}, capture: { capturing: false } })
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 8192 } })
  rt.gpu.device = gpu.device
  return rt
}

// A rough receiver keeps a history of its own, which the final program reads (`reflectionPlan`,
// `heldReflection`); its trace walks the depth bounds, no radiance levels, and a resize remakes them.
test('a rough opaque receiver keeps its own history and walks the depth bounds without radiance levels', () => {
  const rt = roughRuntime()
  const size = native(64, 32)
  makeTargets(rt, rt.gpu.device!, size, frameTargetAllocation(rt, size))
  const old = rt.gpu.reflection!.pyramid!
  assert.equal(old.radiance, false, 'no radiance levels: no cone is asked')
  assert.ok(rt.gpu.reflection!.history, 'its own rough history')
  makeTargets(rt, rt.gpu.device!, native(32, 16), frameTargetAllocation(rt, native(32, 16)))
  assert.notEqual(rt.gpu.reflection!.pyramid, old, 'remade at the new size')
  assert.equal(targetsFit(rt, native(32, 16)), true)
})

// The defect this test catches: the targets made a depth pyramid for the rough trace, while their
// fit asked for another, so every image remade them, and a prepare never settled.
test('targets made for a rough receiver alone fit it: none is remade the next image', () => {
  const rt = roughRuntime()
  const size = native(64, 32)
  makeTargets(rt, rt.gpu.device!, size, frameTargetAllocation(rt, size))
  assert.ok(rt.gpu.reflection!.pyramid, 'the trace walks its own depth bounds')
  assert.equal(targetsFit(rt, size), true)
})
