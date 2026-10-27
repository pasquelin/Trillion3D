// The water's depth is drawn before the marking only where the marking reads it: from the pixels or
// from the froxels (each in a pass of its own), the scene having water that is drawn with its depth
// pass, and a view whose pages are marked at all.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { viewMarking } from '../markingPass.ts'
import { marksWater } from './vsmFrontLayer.ts'

const runtime = (context: object, water = true) =>
  ({ context, run: { frame: 1 }, blendState: { water } }) as unknown as WebgpuPagesRuntime

const marking = (marks: boolean, froxels: boolean) =>
  viewMarking({ shadowMarkPixelPages: marks, shadowMarkPagesUseFroxels: froxels } as ShadowValues)

for (const froxels of [false, true]) {
  const kind = froxels ? 'froxels' : 'pixels'
  test(`the water’s depth is drawn before a marking from the ${kind} where the water is drawn with its depth pass`, () => {
    const view = (context: object, water = true) =>
      marksWater(runtime({ shadowMarkPagesUseFroxels: froxels, ...context }, water))
    assert.equal(marking(true, froxels), kind)
    assert.ok(view({}))
    assert.ok(!view({}, false), 'no water')
    assert.ok(!view({ singleLayerWater: false }), 'the water is off')
    assert.ok(!view({ singleLayerWaterDepthPrepass: false }), 'no depth pass to draw')
    // shadowMarkPixelPages off marks no page of the view: not from the pixels, not from the froxels.
    assert.equal(marking(false, froxels), 'none')
    assert.ok(!view({ shadowMarkPixelPages: false }), 'no page marked: no water depth ahead of it')
  })
}
