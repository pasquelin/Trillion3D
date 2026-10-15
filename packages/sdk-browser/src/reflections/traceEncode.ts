import { buildComputeStages } from '../gpu/core/computeStages.ts'
import { REFLECTION_GROUP } from './viewLayout.ts'
import { resetTileList } from './grids.ts'
import { classifyGroups, classifyLayout } from './tiles.ts'
import { traceLayouts } from './traceBindings.ts'
import {
  KERNELS,
  traceGroups,
  type TraceInputs,
  type TraceLayouts,
  type TraceResources,
} from './traceGroups.ts'

/** The kernels' entries on their module, the opaque surface's then the front one's. */
const ENTRIES = {
  trace: ['traceSurface', 'traceSurface'],
  spatial: ['spatialSurface', 'spatialSurface'],
  temporal: ['temporalSurface', 'temporalSurface'],
  bilateral: ['bilateralOpaque', 'bilateralFront'],
} as const

/** The reflections' kernels on their modules — the classification's (`REFLECTION_CLASSIFY_SHADER`)
 *  and the trace's (`REFLECTION_TRACE_SHADER`) —, each surface's, the kernels over the reflection
 *  group's layout `groupLayout` (`reflectionLayout`). */
export async function createTraceStages(
  device: GPUDevice,
  modules: { trace: GPUShaderModule; classify: GPUShaderModule },
  groupLayout: GPUBindGroupLayout,
) {
  const layouts: TraceLayouts = { ...traceLayouts(device), classify: classifyLayout(device) }
  const kernelLayouts = (layer: number) =>
    ({
      trace: layouts.trace,
      spatial: layouts.spatial,
      temporal: layouts.temporal,
      bilateral: layer === 0 ? layouts.bilateral : layouts.bilateralFront,
    }) as const
  // The surface's layer, the pipeline's (`REFLECTION_LAYER_WGSL`): 0 the opaque, 1 the front.
  const surface = async (layer: number) => {
    const own = kernelLayouts(layer)
    const built = await Promise.all(
      KERNELS.map((kernel) =>
        buildComputeStages(
          device,
          [own[kernel], groupLayout],
          modules.trace,
          [ENTRIES[kernel][layer]],
          { REFLECTION_LAYER: layer },
        ).then((s) => s[ENTRIES[kernel][layer]]),
      ),
    )
    return Object.fromEntries(KERNELS.map((kernel, at) => [kernel, built[at]])) as Record<
      (typeof KERNELS)[number],
      GPUComputePipeline
    >
  }
  const [opaque, front, classify] = await Promise.all([
    surface(0),
    surface(1),
    buildComputeStages(device, [layouts.classify], modules.classify, ['classifyTiles']),
  ])
  return { layouts, opaque, front, classify: classify.classifyTiles }
}
type TraceStages = Awaited<ReturnType<typeof createTraceStages>>

/**
 * The reflections of the pixels of `size`, in the open compute `pass` (`trace.ts`): for the opaque
 * surface — and, with `front`, the image's front pass having written a reflecting surface, for the
 * front one —, its tiles listed (`tiles.ts`), then its rays traced, reused across neighbours,
 * accumulated and filtered into its answer, each kernel dispatched over the list, indirectly.
 * `depthGroup` is the reflection group over the depth pyramid. The history's parity turns every call.
 */
export function encodeReflectionTrace(
  pass: GPUComputePassEncoder,
  reflection: TraceResources,
  stages: TraceStages,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
  front: boolean,
) {
  const groups = traceGroups(reflection, stages, stages.layouts, inputs)
  const parity = (reflection.trace.parity ^= 1)
  const surface = (side: 'opaque' | 'front') => {
    const { tiles, textures } = side === 'opaque' ? reflection.grids : reflection.front.grids
    // The list's head set before the image's commands run (`writeBuffer` precedes the submit).
    resetTileList(reflection.device, tiles)
    pass.setPipeline(stages.classify)
    pass.setBindGroup(0, groups[side].classify[parity])
    // Over the grids' own tiles, which the list holds a word each: the view's, or fewer.
    const [x, y] = classifyGroups([
      Math.min(size[0], textures[0].width),
      Math.min(size[1], textures[0].height),
    ])
    pass.dispatchWorkgroups(x, y)
    for (const kernel of KERNELS) {
      pass.setPipeline(stages[side][kernel])
      pass.setBindGroup(0, groups[side][kernel][parity])
      pass.setBindGroup(REFLECTION_GROUP, depthGroup)
      pass.dispatchWorkgroupsIndirect(tiles, 0)
    }
  }
  surface('opaque')
  if (front) surface('front')
}
