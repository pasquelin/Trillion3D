import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { computeBufferEntry } from '../../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import type { PoolMarker } from '../../bounce/pool/pool.ts'
import { markPoint } from '../../bounce/pool/poolMarkWgsl.ts'
import { screenProbeSettingsOf } from '../../bounce/screen/settingsOf.ts'

const GRID = 0
const MARKS = 1
const LABEL = 'Trillion3D bounce marks the eye'

/** The share of a level's answer at the eye above which the level takes the mark: a fixed half, as the cells of the view are read. */
export const EYE_MARK_FADE = 0.5

/** The one thread of the mark: the probes round the eye in the finest level that holds it half a cell inside its edge (`markPointBiased`). */
export const EYE_MARK_SHADER = wgslProgram(
  `@group(0) @binding(${GRID}) var<uniform> bounce:BounceGrid;
@compute @workgroup_size(1)
fn markEye(){
 if(bounce.counts.w==0u){return;}
 markPointBiased(bounce.eye.xyz,${EYE_MARK_FADE},0u);
}`,
  [markPoint(MARKS)],
)

const kernel = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: LABEL,
    entries: [computeBufferEntry(GRID, 'uniform'), computeBufferEntry(MARKS, 'storage')],
  })
  const stages = startedComputeStages(
    device,
    LABEL,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({ label: LABEL, code: EYE_MARK_SHADER }),
    ['markEye'],
  )
  return { layout, stages }
})

/** Whether the scene view is shown with the world's probes as the far light: the probes round the eye are then asked for. */
const asked = (rt: WebgpuPagesRuntime) =>
  rt.run.diagnostic === 'scene-visualization' &&
  screenProbeSettingsOf(rt).values.visualizeSceneTraceRadianceCache

/**
 * THE MARK OF THE CELLS ROUND THE EYE (`PoolMarker`), while the scene view reads the world's probes as its far light
 * (`visualizeSceneTraceRadianceCache`): so that the probes the view interpolates exist even where no surface of the image stands near
 * the eye. A thread marks the probes round the eye in the level that covers it.
 */
export function eyeMarker(rt: WebgpuPagesRuntime): PoolMarker {
  let held: { grid: GPUBuffer; marks: GPUBuffer; group: GPUBindGroup } | undefined
  return {
    mark(pass, grid, marks) {
      const device = rt.gpu.device
      if (!device || !asked(rt)) return
      const made = kernel(device)
      if (!made.stages.ready) return
      if (held?.grid !== grid || held.marks !== marks)
        held = {
          grid,
          marks,
          group: device.createBindGroup({
            layout: made.layout,
            entries: [
              { binding: GRID, resource: { buffer: grid } },
              { binding: MARKS, resource: { buffer: marks } },
            ],
          }),
        }
      pass.setPipeline(made.stages.pipelineOf('markEye'))
      pass.setBindGroup(0, held.group)
      pass.dispatchWorkgroups(1)
    },
  }
}
