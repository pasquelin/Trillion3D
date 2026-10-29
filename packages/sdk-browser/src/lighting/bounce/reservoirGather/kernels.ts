import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { oncePerDevice, oncePerDeviceKey } from '../../../gpu/core/oncePerDevice.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { TRACE_TRACED_SCENE } from '../screen/traceTracedWgsl.ts'
import { IMAGE_ENTRIES, imageEntries, imageProgram } from './imageWgsl.ts'
import { RESAMPLE_ENTRIES, resampleEntries, resampleProgram } from './resampleWgsl.ts'
import {
  RESERVOIR_TRACE_ENTRY,
  reservoirTraceEntries,
  reservoirTraceProgram,
  reservoirTraceSceneEntries,
} from './traceWgsl.ts'

/** A set of kernels compiled off the frame: the layouts of its groups, in the order of the groups, and whether every kernel is ready to bind. */
function started<E extends string>(
  device: GPUDevice,
  label: string,
  groups: readonly GPUBindGroupLayout[],
  code: string,
  entries: readonly E[],
) {
  const stages = startedComputeStages(
    device,
    label,
    device.createPipelineLayout({ bindGroupLayouts: groups }),
    device.createShaderModule({ label, code }),
    entries,
  )
  return {
    layouts: groups,
    get ready() {
      return stages.ready
    },
    pipeline: (entry: E) => stages.pipelineOf(entry),
  }
}

/** The kernel that casts the rays of the reservoirs through the scene's triangles (the first rays and the validation), for a surface cache stored in `light`: its group 0 with the cut's tables and the cards, the reflection group, the scene trace's. */
export const traceKernel = oncePerDeviceKey((device: GPUDevice, light: LightAtlasFormat) => {
  const label = `Trillion3D reservoir rays ${light}`
  const groups: GPUBindGroupLayout[] = []
  groups[0] = device.createBindGroupLayout({ label, entries: reservoirTraceEntries(light) })
  groups[1] = reflectionLayout(device)
  groups[TRACE_TRACED_SCENE.group] = device.createBindGroupLayout({
    label,
    entries: reservoirTraceSceneEntries(),
  })
  return started(device, label, groups, reservoirTraceProgram(light), [RESERVOIR_TRACE_ENTRY])
})

/** The kernels that resample the reservoirs (clearing, temporal, one spatial pass). */
export const resampleKernel = oncePerDevice((device: GPUDevice) => {
  const label = 'Trillion3D reservoir resampling'
  return started(
    device,
    label,
    [device.createBindGroupLayout({ label, entries: resampleEntries() }), reflectionLayout(device)],
    resampleProgram(),
    Object.values(RESAMPLE_ENTRIES),
  )
})

/** The kernels that work on the pixels (upsampling, accumulation, bilateral filter). */
export const imageKernel = oncePerDevice((device: GPUDevice) => {
  const label = 'Trillion3D reservoir pixels'
  return started(
    device,
    label,
    [device.createBindGroupLayout({ label, entries: imageEntries() }), reflectionLayout(device)],
    imageProgram(),
    Object.values(IMAGE_ENTRIES),
  )
})
