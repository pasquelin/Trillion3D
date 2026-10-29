import { clamp } from '../../../../math/src/scalar/reals.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { DEPTH_COMPARE_OR_EQUAL } from '../../camera/depthConvention.ts'
import {
  HARDWARE_OCCLUSION_BOX_PASS,
  HARDWARE_OCCLUSION_VERDICT_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { composeGroup, heldGroup } from '../../gpu/bind/bindIdentity.ts'
import { liveBuffer } from '../../gpu/bind/liveEntries.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import {
  BOX_VERTICES,
  MAX_QUERIES,
  OCCLUSION_BOX_ENTRY,
  OCCLUSION_BOX_WGSL,
  OCCLUSION_VERDICT_ENTRY,
  OCCLUSION_VERDICT_WGSL,
  QUERY_BATCH,
} from './hardwareOcclusionWgsl.ts'

/** The boxes' vertex stage on its own layout, prepared off the frame once a device: depth tested against the depth the image drew, nothing written, no face culled. */
const boxPipeline = oncePerDevice((device: GPUDevice) =>
  preparedPipeline(device, {
    label: HARDWARE_OCCLUSION_BOX_PASS,
    layout: 'auto',
    vertex: {
      module: device.createShaderModule({
        label: HARDWARE_OCCLUSION_BOX_PASS,
        code: OCCLUSION_BOX_WGSL,
      }),
      entryPoint: OCCLUSION_BOX_ENTRY,
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: false,
      depthCompare: DEPTH_COMPARE_OR_EQUAL,
    },
  }),
)
const verdictKernel = autoKernel(
  HARDWARE_OCCLUSION_VERDICT_PASS,
  OCCLUSION_VERDICT_WGSL,
  OCCLUSION_VERDICT_ENTRY,
)

/** What a session holds of the queries: the set, the counts they resolve to and the groups of the two passes. */
export interface HardwareQueries {
  readonly set: GPUQuerySet
  readonly samples: GPUBuffer
  readonly boxGroup: ReturnType<typeof heldGroup>
  readonly verdictGroup: ReturnType<typeof heldGroup>
  readonly buffers: HardwareBuffers
}

/** The queries for `capacity` roots at most (one query a group of `QUERY_BATCH`, `MAX_QUERIES` the most: roots past them are never queried, so never hidden). */
export function createHardwareQueries(
  device: GPUDevice,
  capacity: number,
  buffers: HardwareBuffers,
): HardwareQueries {
  const count = clamp(ceilDiv(capacity, QUERY_BATCH), 1, MAX_QUERIES)
  return {
    set: device.createQuerySet({ type: 'occlusion', count }),
    samples: device.createBuffer({
      label: 'Trillion3D hardware occlusion counts',
      size: count * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.STORAGE,
    }),
    boxGroup: heldGroup(),
    verdictGroup: heldGroup(),
    buffers,
  }
}

/** The queries let go. */
export function destroyHardwareQueries(queries: HardwareQueries) {
  queries.set.destroy()
  queries.samples.destroy()
}

/** The buffers the passes read and write: the uniform and the corners the roots' pass wrote, the bits of the roots it never rejects and the verdict. */
export type HardwareBuffers = {
  params: () => GPUBuffer | undefined
  corners: () => GPUBuffer | undefined
  unculled: () => GPUBuffer | undefined
  verdict: () => GPUBuffer | undefined
}

/**
 * THE ROOTS' BOXES UNDER HARDWARE OCCLUSION QUERIES, encoded after the corners pass: sixteen roots' boxes to a query, each group drawn depth tested against the image's depth
 * with the samples it lets through counted, the counts resolved, and a verdict a root from them — hidden where its group let none through. Nothing till the two pipelines compile;
 * whether the verdicts were written.
 */
export function encodeHardwareQueries(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  queries: HardwareQueries,
  roots: number,
) {
  const depth = rt.gpu.depthView
  const box = boxPipeline(device).get(),
    verdict = verdictKernel(device).get()
  if (!depth || !box || !verdict) return false
  const { buffers } = queries
  const groups = Math.min(MAX_QUERIES, ceilDiv(roots, QUERY_BATCH))
  queries.boxGroup.identity.entries[0] ??= sequentialEntries([
    liveBuffer(buffers.params),
    liveBuffer(buffers.corners),
  ])
  queries.verdictGroup.identity.entries[0] ??= sequentialEntries([
    liveBuffer(buffers.params),
    liveBuffer(buffers.corners),
    liveBuffer(buffers.unculled),
    liveBuffer(() => queries.samples),
    liveBuffer(buffers.verdict),
  ])
  composeGroup(device, queries.boxGroup, box)
  composeGroup(device, queries.verdictGroup, verdict)
  const pass = encoder.beginRenderPass({
    label: HARDWARE_OCCLUSION_BOX_PASS,
    colorAttachments: [],
    depthStencilAttachment: { view: depth, depthReadOnly: true },
    occlusionQuerySet: queries.set,
  })
  pass.setPipeline(box)
  pass.setBindGroup(0, queries.boxGroup.group!)
  pass.setViewport(0, 0, rt.gpu.targetSize[0], rt.gpu.targetSize[1], 0, 1)
  for (let group = 0; group < groups; group++) {
    pass.beginOcclusionQuery(group)
    pass.draw(BOX_VERTICES, QUERY_BATCH, 0, group * QUERY_BATCH)
    pass.endOcclusionQuery()
  }
  pass.end()
  encoder.resolveQuerySet(queries.set, 0, groups, queries.samples, 0)
  const compute = encoder.beginComputePass({ label: HARDWARE_OCCLUSION_VERDICT_PASS })
  compute.setPipeline(verdict)
  compute.setBindGroup(0, queries.verdictGroup.group!)
  dispatchRows(compute, ceilDiv(roots, WORKGROUP_THREADS))
  compute.end()
  rt.run.gpuComputeDispatches++
  return true
}
