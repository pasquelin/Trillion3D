// The water's depth is drawn before the marking only where the marking reads it: from the pixels, the
// scene having water that is drawn with its depth pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { viewMarking } from '../markingPass.ts'
import { marksWaterSurface } from './vsmFrontLayer.ts'

const runtime = (context: object, water = true) =>
  ({ context, run: { frame: 1 }, blendState: { water } }) as unknown as WebgpuPagesRuntime

const marking = (marks: boolean, froxels: boolean) =>
  viewMarking({ shadowMarkPixelPages: marks, shadowMarkPagesUseFroxels: froxels } as ShadowValues)

test("the water's depth is drawn before the marking where the pixels are marked and the water is drawn", () => {
  assert.equal(marking(true, false), 'pixels')
  assert.ok(marksWaterSurface(runtime({ shadowMarkPagesUseFroxels: false })))
  assert.ok(!marksWaterSurface(runtime({ shadowMarkPagesUseFroxels: false }, false)), 'no water')
  assert.ok(!marksWaterSurface(runtime({ singleLayerWater: false })), 'the water is off')
  assert.ok(
    !marksWaterSurface(runtime({ singleLayerWaterDepthPrepass: false })),
    'no depth pass to draw',
  )
  const froxels = runtime({ shadowMarkPagesUseFroxels: true })
  assert.equal(marking(true, true), 'froxels')
  assert.ok(!marksWaterSurface(froxels), 'the froxels read no water depth')
})

test('shadowMarkPixelPages off marks no page of the view: not from the pixels, not from the froxels, no water depth ahead of it', () => {
  for (const froxels of [false, true]) {
    const off = runtime({ shadowMarkPixelPages: false, shadowMarkPagesUseFroxels: froxels })
    assert.equal(marking(false, froxels), 'none', `froxels ${froxels}: nothing is marked`)
    assert.ok(!marksWaterSurface(off), `froxels ${froxels}: the water's depth is not drawn for it`)
  }
})
