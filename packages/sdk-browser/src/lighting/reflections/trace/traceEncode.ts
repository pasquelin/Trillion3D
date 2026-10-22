import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import {
  REFLECTION_DENOISE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_TRACE_PASS,
} from '../../../diagnostic/stage/passLabels.ts'
import { REFLECTION_GROUP } from '../viewLayout.ts'
import { classifyGroups } from '../tiles.ts'
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
  clearTracing: ['clearTracing', 'clearTracing'],
  scene: ['traceScene', 'traceScene'],
  clear: ['clearOpaque', 'clearFront'],
  resolve: ['resolveSurface', 'resolveSurface'],
  temporal: ['temporalSurface', 'temporalSurface'],
  bilateral: ['bilateralOpaque', 'bilateralFront'],
} as const

/** The reflections' kernels on the trace's module (`REFLECTION_TRACE_SHADER`) — the classification
 *  (`../tiles.ts`) and each surface's —, over the reflection group's layout `groupLayout`
 *  (`reflectionLayout`). */
export async function createTraceStages(
  device: GPUDevice,
  modules: { trace: GPUShaderModule },
  groupLayout: GPUBindGroupLayout,
) {
  const layouts: TraceLayouts = traceLayouts(device)
  const kernelLayouts = (layer: number) =>
    ({
      screen: layouts.screen,
      clearTracing: layouts.clearTracing,
      scene: layouts.scene,
      clear: layer === 0 ? layouts.clear : layouts.clearFront,
      resolve: layouts.resolve,
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
    buildComputeStages(device, [layouts.classify, groupLayout], modules.trace, ['classifyTiles']),
  ])
  return { layouts, opaque, front, classify: classify.classifyTiles }
}
type TraceStages = Awaited<ReturnType<typeof createTraceStages>>

/** The trace's passes, each timed alone under its label: the screen stage (the classification first)
 *  and the clear of the unused tracing tiles, the scene stage, the denoising — the last pass's clear
 *  over the clear tiles, then the resolve, the accumulation and the last pass over the resolve tiles —;
 *  and their kernels. */
const PASSES = [
  { label: REFLECTION_TRACE_PASS, kernels: ['screen', 'clearTracing'] },
  { label: REFLECTION_SCENE_PASS, kernels: ['scene'] },
  { label: REFLECTION_DENOISE_PASS, kernels: ['clear', 'resolve', 'temporal', 'bilateral'] },
] as const satisfies readonly { label: string; kernels: readonly (typeof KERNELS)[number][] }[]

/** The list each kernel is dispatched over. */
const LISTS = {
  screen: 'tracing',
  clearTracing: 'clearTracing',
  scene: 'pending',
  clear: 'clear',
  resolve: 'resolve',
  temporal: 'resolve',
  bilateral: 'resolve',
} as const satisfies Record<(typeof KERNELS)[number], string>

/** The surfaces a trace answers: the opaque one alone, or the front one after it. */
const OPAQUE = ['opaque'] as const
const BOTH = ['opaque', 'front'] as const

/** The classification's workgroups, written in place each image (`classifyGroups`). */
const classifying: [number, number] = [0, 0]

/** Bytes of a list's head: its three dispatch arguments and its count (`createReflectionGrids`). */
const HEAD_BYTES = 16

/**
 * The reflections of the pixels of `size` in the trace's three passes on `encoder` (`PASSES`), each
 * opened, filled and ended in turn (`trace.ts`): for the opaque surface — and, with `front`, the image's
 * front pass having written a reflecting surface, for the front one —, its lists emptied on the encoder,
 * its tiles classified (`../tiles.ts`) over the grid of this image's blocks and its rays traced on the
 * screen; the rays the screen left traced through the scene; then resolved, accumulated and filtered
 * over the resolve tiles, and answered by the field over the clear ones. Every kernel after the
 * classification is dispatched indirectly: over a list of tiles, the scene stage over the rays left.
 * `depthGroup` is the reflection group over the depth pyramid, `block` the side of the blocks of pixels a grid texel
 * traces (the level's row). The history's parity turns every call.
 */
export function encodeReflectionTrace(
  encoder: GPUCommandEncoder,
  reflection: TraceResources,
  stages: TraceStages,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
  block: number,
  front: boolean,
) {
  const groups = traceGroups(reflection, stages, stages.layouts, inputs)
  const parity = (reflection.trace.parity ^= 1)
  const sides = front ? BOTH : OPAQUE
  for (const side of sides) {
    const { lists, head } = side === 'opaque' ? reflection.grids : reflection.front.grids
    // Each head as an image starts it, the third argument one: one copy a list.
    for (const list of lists) encoder.copyBufferToBuffer(head, 0, list, 0, HEAD_BYTES)
  }
  for (const { label, kernels } of PASSES) {
    const pass = encoder.beginComputePass({ label })
    // The depth pyramid's group, every kernel's: set once, kept across their pipelines.
    pass.setBindGroup(REFLECTION_GROUP, depthGroup)
    for (const side of sides) {
      const grids = side === 'opaque' ? reflection.grids : reflection.front.grids
      if (label === REFLECTION_TRACE_PASS) {
        pass.setPipeline(stages.classify)
        pass.setBindGroup(0, groups[side].classify[parity])
        const [x, y] = classifyGroups(size, block, classifying)
        pass.dispatchWorkgroups(x, y)
      }
      for (const kernel of kernels) {
        pass.setPipeline(stages[side][kernel])
        pass.setBindGroup(0, groups[side][kernel][parity])
        pass.dispatchWorkgroupsIndirect(grids[LISTS[kernel]], 0)
      }
    }
    pass.end()
  }
}
