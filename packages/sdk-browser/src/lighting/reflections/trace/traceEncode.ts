import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import {
  REFLECTION_DENOISE_PASS,
  REFLECTION_SCENE_PASS,
  REFLECTION_TRACE_PASS,
} from '../../../diagnostic/stage/passLabels.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { REFLECTION_SIDE } from '../constants.ts'
import { resetListIn } from '../../../gpu/dispatch/list.ts'
import { REFLECTION_GROUP } from '../viewLayout.ts'
import { classifyGroups } from '../tiles.ts'
import { REFLECTION_HARDWARE_SCENE } from './traceBindings.ts'
import { hardwareTraceGroups } from './traceHardwareGroups.ts'
import {
  KERNELS,
  traceGroups,
  type TraceInputs,
  type TraceLayouts,
  type TraceResources,
} from './traceGroups.ts'

/** The kernels' entries on their module, the opaque surface's then the front one's. */
const ENTRIES = {
  generate: ['generateRays', 'generateRays'],
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
 *  (`reflectionLayout`) and their groups 0's layouts `layouts` (`traceLayouts`), made by the caller
 *  before its first `await`, in its validation scope. */
export async function createTraceStages(
  device: GPUDevice,
  modules: { trace: GPUShaderModule },
  groupLayout: GPUBindGroupLayout,
  layouts: TraceLayouts,
) {
  const kernelLayouts = (layer: number) =>
    ({
      generate: layouts.generate,
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
  const [opaque, front, classify, keepDepth] = await Promise.all([
    surface(0),
    surface(1),
    buildComputeStages(device, [layouts.classify, groupLayout], modules.trace, ['classifyTiles']),
    buildComputeStages(device, [layouts.keepDepth, groupLayout], modules.trace, ['keepDepth']),
  ])
  return {
    layouts,
    opaque,
    front,
    classify: classify.classifyTiles,
    keepDepth: keepDepth.keepDepth,
  }
}
type TraceStages = Awaited<ReturnType<typeof createTraceStages>>

/** The scene stage that casts its rays through the scene's triangles, compiled: its pipeline for the opaque surface (0) and the
 *  transparents' front one (1) (`hardwareReflectionKernels`, `../reflectionPipelines.ts`). */
interface HardwareStage {
  pipeline(layer: number): GPUComputePipeline
  /** The format of the surface cache's final light the stage is for (`lightAtlasFormat`). */
  readonly light: LightAtlasFormat
}

/** The trace's passes, each timed alone under its label: the clear of the unused tracing tiles, the ray generation and the screen stage (the
 *  classification first, the clear then the generation before the screen march), the scene stage, the denoising — the last pass's clear
 *  over the clear tiles, then the resolve, the accumulation and the last pass over the resolve tiles —;
 *  and their kernels. */
const PASSES = [
  { label: REFLECTION_TRACE_PASS, kernels: ['clearTracing', 'generate', 'screen'] },
  { label: REFLECTION_SCENE_PASS, kernels: ['scene'] },
  { label: REFLECTION_DENOISE_PASS, kernels: ['clear', 'resolve', 'temporal', 'bilateral'] },
] as const satisfies readonly { label: string; kernels: readonly (typeof KERNELS)[number][] }[]

/** The list each kernel is dispatched over. */
const LISTS = {
  generate: 'tracing',
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

/** Whether the resolve of `side` reads the rays of texels outside its own tile: it reconstructs from its neighbours, or its blocks are larger than a pixel. */
const readsNeighbours = (
  side: (typeof BOTH)[number],
  block: readonly [number, number],
  frontBlock: readonly [number, number],
  reconstruct: readonly [boolean, boolean],
) => {
  const [x, y] = side === 'opaque' ? block : frontBlock
  return reconstruct[side === 'opaque' ? 0 : 1] || x !== 1 || y !== 1
}

/** The classification's workgroups, written in place each image (`classifyGroups`). */
const classifying: [number, number] = [0, 0]

/** Each list's head as an image starts it, of each side the image traces: one copy a list. */
function resetHeads(
  encoder: GPUCommandEncoder,
  reflection: TraceResources,
  sides: readonly ('opaque' | 'front')[],
) {
  for (const side of sides) {
    const { lists } = side === 'opaque' ? reflection.grids : reflection.front.grids
    for (const list of lists) resetListIn(reflection.device, encoder, list)
  }
}

/**
 * The reflections of the pixels of `size` in the trace's three passes on `encoder` (`PASSES`), each
 * opened, filled and ended in turn (`trace.ts`): for the opaque surface — and, with `front`, the image's
 * front pass having written a reflecting surface, for the front one —, its lists emptied on the encoder,
 * its tiles classified (`../tiles.ts`) over the grid of this image's blocks, its rays generated (the kernel `generateRays`, after the clear of the
 * unused tiles, as the reference's pass of its own is) and traced on the screen; the rays the screen missed traced through the scene; then resolved, accumulated and filtered
 * over the resolve tiles, and answered by the field over the clear ones. Every kernel after the
 * classification is dispatched indirectly: over a list of tiles, the scene stage over the rays missed.
 * `depthGroup` is the reflection group over the depth pyramid, `block` the blocks of pixels a grid texel
 * traces, across and down (the level's row), `frontBlock` the front layer's, `reconstruct` whether the opaque surface's and
 * the front one's resolve reads the neighbours' rays. The clear of the unused tracing tiles runs only where a resolve reads
 * a texel of another tile: a surface reconstructing, or tracing for blocks larger than one pixel. With `hardware` and the scene
 * trace of the image (`inputs.rays`) the scene stage is the program that casts its rays through the scene's triangles
 * (`../sceneTraceHardware.ts`), over its own groups (`traceHardwareGroups.ts`). The history's parity turns every call.
 */
export function encodeReflectionTrace(
  encoder: GPUCommandEncoder,
  reflection: TraceResources,
  stages: TraceStages,
  inputs: TraceInputs,
  depthGroup: GPUBindGroup,
  size: readonly [number, number],
  block: readonly [number, number],
  frontBlock: readonly [number, number],
  reconstruct: readonly [boolean, boolean],
  front: boolean,
  hardware?: HardwareStage,
) {
  const groups = traceGroups(reflection, stages, stages.layouts, inputs)
  const traced =
    hardware && inputs.rays
      ? {
          stage: hardware,
          groups: hardwareTraceGroups(reflection, inputs, inputs.rays, hardware.light),
        }
      : undefined
  const parity = (reflection.trace.parity ^= 1)
  const sides = front ? BOTH : OPAQUE
  resetHeads(encoder, reflection, sides)
  for (const { label, kernels } of PASSES) {
    const pass = encoder.beginComputePass({ label })
    // The depth pyramid's group, every kernel's: set once, kept across their pipelines.
    pass.setBindGroup(REFLECTION_GROUP, depthGroup)
    for (const side of sides) {
      const grids = side === 'opaque' ? reflection.grids : reflection.front.grids
      if (label === REFLECTION_TRACE_PASS) {
        pass.setPipeline(stages.classify)
        pass.setBindGroup(0, groups[side].classify[parity])
        const [x, y] = classifyGroups(size, side === 'opaque' ? block : frontBlock, classifying)
        pass.dispatchWorkgroups(x, y)
      }
      for (const kernel of kernels) {
        if (kernel === 'clearTracing' && !readsNeighbours(side, block, frontBlock, reconstruct))
          continue
        if (kernel === 'scene' && traced) {
          pass.setPipeline(traced.stage.pipeline(side === 'opaque' ? 0 : 1))
          pass.setBindGroup(0, traced.groups[side])
          pass.setBindGroup(REFLECTION_HARDWARE_SCENE.group, traced.groups.scene)
          pass.dispatchWorkgroupsIndirect(grids[LISTS[kernel]], 0)
          continue
        }
        pass.setPipeline(stages[side][kernel])
        pass.setBindGroup(0, groups[side][kernel][parity])
        pass.dispatchWorkgroupsIndirect(grids[LISTS[kernel]], 0)
      }
    }
    // The opaque depth of this image, kept after every kernel that reads the last image's, for the next image's hits.
    if (label === REFLECTION_DENOISE_PASS) {
      pass.setPipeline(stages.keepDepth)
      pass.setBindGroup(0, groups.keepDepth)
      pass.dispatchWorkgroups(ceilDiv(size[0], REFLECTION_SIDE), ceilDiv(size[1], REFLECTION_SIDE))
    }
    pass.end()
  }
}
