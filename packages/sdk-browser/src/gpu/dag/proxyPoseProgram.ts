// THE POSE'S PROGRAM (`proxyPose.ts`): its layout — the arena, the float pool, the poses, the levels'
// ids, the level's parameters — and its two kernels (`../../bounce/runtimePoseWgsl.ts`).
import { preparedComputePipeline, started } from '../../lighting/deferred/fullscreen.ts'
import { oncePerDevice } from '../core/oncePerDevice.ts'
import { computeBufferEntry, computeUniformEntry } from '../core/computeBindings.ts'
import { POSE_STEP_WORDS, RUNTIME_POSE_SHADER } from '../../bounce/runtimePoseWgsl.ts'
import { PROXY_POSE_PASS } from '../../stage/passLabels.ts'

/** The pose's program on a device: its layout and its two kernels, compiled off the frame. */
export const posePrograms = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(0, 'storage'),
      computeBufferEntry(1, 'read-only-storage'),
      computeBufferEntry(2, 'read-only-storage'),
      computeBufferEntry(3, 'read-only-storage'),
      computeUniformEntry(4, { hasDynamicOffset: true, minBindingSize: POSE_STEP_WORDS * 4 }),
    ],
  })
  const module = device.createShaderModule({ label: PROXY_POSE_PASS, code: RUNTIME_POSE_SHADER })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const kernel = (entryPoint: string) =>
    started(
      preparedComputePipeline(device, {
        label: PROXY_POSE_PASS,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      }),
    )
  return { layout, corners: kernel('poseCorners'), fit: kernel('fitNodes') }
})
