import { buildComputeStages } from '../gpu/core/computeStages.ts'
import {
  REFLECTION_DENOISE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_TRACE_PASS,
} from '../stage/passLabels.ts'
import { REFLECTION_GROUP } from './viewLayout.ts'
import { resetList } from '../gpu/dispatch/list.ts'
import { gridExtent } from './grids.ts'
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
  screen: ['traceScreen', 'traceScreen'],
  scene: ['traceScene', 'traceScene'],
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
      screen: layouts.screen,
      scene: layouts.scene,
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

/** The trace's passes, each timed alone under its label: the screen stage (the classification first),
 *  the scene stage, the denoising; and their kernels. */
const PASSES = [
  { label: REFLECTION_TRACE_PASS, kernels: ['screen'] },
  { label: REFLECTION_SCENE_PASS, kernels: ['scene'] },
  { label: REFLECTION_DENOISE_PASS, kernels: ['spatial', 'temporal', 'bilateral'] },
] as const satisfies readonly { label: string; kernels: readonly (typeof KERNELS)[number][] }[]

/**
 * The reflections of the pixels of `size` in the trace's three passes on `encoder` (`PASSES`), each
 * opened, filled and ended in turn (`trace.ts`): for the opaque surface — and, with `front`, the image's front pass having
 * written a reflecting surface, for the front one —, its tiles listed (`tiles.ts`) and its rays traced
 * on the screen; the rays the screen left traced through the scene; then reused across neighbours,
 * accumulated and filtered into its answer. Every kernel is dispatched indirectly: over the tiles, the
 * scene stage over the rays left. `depthGroup` is the reflection group over the depth pyramid. The
 * history's parity turns every call.
 */
export function encodeReflectionTrace(
  encoder: GPUCommandEncoder,
  reflection: TraceResources,
  stages: TraceStages,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
  front: boolean,
) {
  const groups = traceGroups(reflection, stages, stages.layouts, inputs)
  const parity = (reflection.trace.parity ^= 1)
  const sides = front ? (['opaque', 'front'] as const) : (['opaque'] as const)
  for (const { label, kernels } of PASSES) {
    const pass = encoder.beginComputePass({ label })
    for (const side of sides) {
      const { tiles, pending, textures } =
        side === 'opaque' ? reflection.grids : reflection.front.grids
      if (label === REFLECTION_TRACE_PASS) {
        // The lists' heads set before the image's commands run (`writeBuffer` precedes the submit).
        resetList(reflection.device, tiles)
        resetList(reflection.device, pending)
        pass.setPipeline(stages.classify)
        pass.setBindGroup(0, groups[side].classify[parity])
        // Over the grids' own tiles, which the list holds a word each: the view's, or fewer.
        const [gw, gh] = gridExtent(size[0], size[1])
        const [x, y] = classifyGroups([
          Math.min(gw, textures[0].width),
          Math.min(gh, textures[0].height),
        ])
        pass.dispatchWorkgroups(x, y)
      }
      for (const kernel of kernels) {
        pass.setPipeline(stages[side][kernel])
        pass.setBindGroup(0, groups[side][kernel][parity])
        pass.setBindGroup(REFLECTION_GROUP, depthGroup)
        pass.dispatchWorkgroupsIndirect(kernel === 'scene' ? pending : tiles, 0)
      }
    }
    pass.end()
  }
}
