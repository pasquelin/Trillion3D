import test from 'node:test'
import assert from 'node:assert/strict'
import { createDagPipeline } from './pipeline.ts'
import { createCutOcclusion } from './occlusion.ts'
import { dagWorkLayout } from './shader/floorWgsl.ts'
import { validationScope } from '../../gpu/core/errorScope.ts'
import type { CameraFrames, DagGroup } from './cameraFrames.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test("the cut's pipeline is built with every creation under a scope, its groups included", async () => {
  const { device } = fakeDevice({ strictScopes: true })
  // What the cut holds before its pipeline is asked, made under a scope of its own.
  const { value: held } = await validationScope(device, () => {
    const buffer = () => device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE })
    return {
      occlusion: createCutOcclusion(device),
      arm: { work: buffer(), args: buffer(), words: dagWorkLayout(1) },
    }
  })
  // The cut's group is made by the frames, over the layout the pipeline made: a real bind group.
  const frames = {
    bindGroup: (layout: GPUBindGroupLayout) =>
      device.createBindGroup({
        layout,
        entries: [...(layout as unknown as { entries: GPUBindGroupLayoutEntry[] }).entries].map(
          ({ binding }) => ({ binding, resource: {} as GPUBindingResource }),
        ),
      }),
  } as unknown as CameraFrames
  const built = await createDagPipeline(
    device,
    {} as DagGroup,
    frames,
    held.arm,
    held.occlusion.layout,
  )
  assert.equal(built.refused, undefined)
  assert.ok(built.value?.armPipeline && built.value.bindGroup)
})
