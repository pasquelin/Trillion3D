// The water's depth is drawn before the marking only where the marking reads it: from the pixels, the
// scene having water that is drawn with its depth pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { marksFromPixels } from '../markingPass.ts'
import { marksWaterSurface } from './vsmFrontLayer.ts'

const runtime = (context: object, water = true) =>
  ({ context, run: { frame: 1 }, blendState: { water } }) as unknown as WebgpuPagesRuntime

test("the water's depth is drawn before the marking where the pixels are marked and the water is drawn", () => {
  assert.ok(marksFromPixels({ shadowMarkPagesUseFroxels: false } as ShadowValues))
  assert.ok(marksWaterSurface(runtime({ shadowMarkPagesUseFroxels: false })))
  assert.ok(!marksWaterSurface(runtime({ shadowMarkPagesUseFroxels: false }, false)), 'no water')
  assert.ok(!marksWaterSurface(runtime({ singleLayerWater: false })), 'the water is off')
  assert.ok(
    !marksWaterSurface(runtime({ singleLayerWaterDepthPrepass: false })),
    'no depth pass to draw',
  )
  const froxels = runtime({ shadowMarkPagesUseFroxels: true })
  assert.ok(!marksFromPixels({ shadowMarkPagesUseFroxels: true } as ShadowValues))
  assert.ok(!marksWaterSurface(froxels), 'the froxels read no water depth')
})
