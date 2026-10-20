// THE POSE'S PROGRAM (`proxyPose.ts`): its layout — the arena, the float pool, the poses, the levels'
// ids, the level's parameters — and its two kernels (`../../../lighting/bounce/runtime/runtimePoseWgsl.ts`).
import { started } from '../../../lighting/deferred/fullscreen.ts'
import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { computeBufferEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import {
  POSE_STEP_WORDS,
  RUNTIME_POSE_SHADER,
} from '../../../lighting/bounce/runtime/runtimePoseWgsl.ts'
import { PROXY_POSE_PASS } from '../../../diagnostic/stage/passLabels.ts'

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
      preparedComputeStage(device, pipelineLayout, module, entryPoint, undefined, PROXY_POSE_PASS),
    )
  return { layout, corners: kernel('poseCorners'), fit: kernel('fitNodes') }
})
