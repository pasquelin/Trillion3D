// The lobes target follows what the image wants (`followLobes`), called at every image's start
// (`encodeVis`): a transmissive lobed surface with no opaque row under it makes it full-size — its
// water stage leaves its lobes there, read by the composite —, and it goes back to its 1×1 once
// the lobe left, the frame's target bytes following it each way.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { createSurfaceBuffer } from '../../../scene/surfaceAllocation.ts'
import { followLobes, lobesHeld } from './lobesTarget.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

test('a transmissive lobed surface with no opaque row makes the lobes target full-size', () => {
  const { device } = fakeDevice()
  const surfaces = createSurfaceBuffer(device, 8, 4)
  const rt = {
    gpu: { device, surfaces, targetBytes: surfaces.allocationBytes },
    layout: { rows: { packedRecs: [], packedCount: 0, rowWrites: 0, tableEpoch: 0 } },
    blendState: { waterLobed: true },
  } as unknown as WebgpuPagesRuntime
  assert.equal(lobesHeld(rt), false, 'made before the lobe was known: its 1×1')
  followLobes(rt)
  assert.equal(lobesHeld(rt), true, 'the water stage finds its lobes target whole')
  assert.equal(rt.gpu.targetBytes, rt.gpu.surfaces!.allocationBytes)
  const whole = rt.gpu.surfaces
  followLobes(rt)
  assert.equal(rt.gpu.surfaces, whole, 'a target that holds is never remade')
  ;(rt.blendState as { waterLobed: boolean }).waterLobed = false
  followLobes(rt)
  assert.equal(lobesHeld(rt), false, 'the lobe gone, its 1×1 again')
  assert.equal(rt.gpu.targetBytes, rt.gpu.surfaces!.allocationBytes)
})
