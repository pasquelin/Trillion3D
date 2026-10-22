import { reflectionLayout } from '../lighting/reflections/reflectionPipelines.ts'
import { REFLECTION_LIGHT_VIEW_BINDING } from '../lighting/reflections/viewLayout.ts'
import type { FrontOutputs } from '../lighting/reflections/frontLayer.ts'
import { DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts'
import {
  preparedPipeline,
  started,
  type PreparedPipeline,
} from '../lighting/deferred/fullscreen.ts'
import { BLEND_MODES } from '../materials/surface/materialBlending.ts'
import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'
import type { BlendGpuItem } from './state.ts'
import type { ContractKey } from '../lighting/deferred/contractCuts.ts'
import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { CULL_MODES } from './plan/planCull.ts'
import type { DualPasses } from './pipelines.ts'
import type { ShareTargets } from './blendTargets.ts'

/** Pipelines a transparent pass picks by plan rank (`draw.ts`): the blend pass's modes and
 *  transmissive culls, `filtered` in an image with display layers (`display/displayFilter.ts`); a rank
 *  the pass `skips` is not drawn (the display mask draws the filtering modes alone, the distortion
 *  the transmissive items alone); `share`, the share targets they write (`ShareTargets`,
 *  `blendTargets`). */
export type RankedPipelines = {
  at(rank: number, filtered?: boolean, share?: ShareTargets): GPURenderPipeline | undefined
  skips?(rank: number): boolean
}

/** Ranked pipelines that make the one a rank asks for (`RankedPipelines`). */
type MadePipelines = Omit<RankedPipelines, 'at'> & {
  at(rank: number, filtered?: boolean, share?: ShareTargets): GPURenderPipeline
}

/**
 * What a blend program draws its transmissive items with (`./transmission/pipelines.ts`), each set picked
 * by a plan rank's cull past the blend modes' (`TRANSMIT_BASE`): the layer under the single-source
 * fallback on the blend pass's targets (`over`), under its dual blend on the HDR target alone (`dual`, none
 * on a device without `dual-source-blending`), the companion pass of the dual blend (`coverage`:
 * the request and the reactive value), the distortion's accumulation — of the refracting ranks
 * alone (`distortion`), or of every transmissive rank with the companion pass's outputs
 * (`distortionCoverage`), each on the blend group and its own (`distortionGroup`) — and its
 * full-screen application (`apply`, on an empty group 0, `applyEmpty`, and its own, `applyGroup`);
 * then the compile of what the scene reaches (`precompile`).
 */
export interface TransmitPipelines {
  readonly over: MadePipelines
  readonly dual?: MadePipelines
  readonly coverage: MadePipelines
  readonly distortion: MadePipelines
  readonly distortionCoverage: MadePipelines
  readonly apply: PreparedPipeline<GPURenderPipeline>
  readonly applyEmpty: GPUBindGroup
  distortionGroup(view: GPUBuffer, depth: GPUTextureView): GPUBindGroup
  applyGroup(view: GPUBuffer, offsets: GPUTextureView, scene: GPUTextureView): GPUBindGroup
  precompile(reached: { shares: ReadonlySet<ShareTargets>; filtered: boolean }): Promise<unknown>
}

/** The distortion's bind group, after the blend's (`TransmitPipelines.distortion`, `.apply`), and
 *  its bindings: the deferred view on the reflection group's number, which the blend module declares
 *  (`reflectionLightViewWgsl`), then on numbers the reflection group leaves free the opaque depth,
 *  which the accumulation reads, and the offsets, the scene copy and its bilinear sampler, which the
 *  application reads. */
export const DISTORTION_GROUP = 1
export const DISTORTION_BINDINGS = {
  view: REFLECTION_LIGHT_VIEW_BINDING,
  depth: 11,
  offsets: 12,
  scene: 13,
  sampler: 14,
} as const

/** Whether `device` was granted dual-source blending (`requestExplorerDevice`): a transmissive
 *  layer then blends dual, add and multiply in one pass (`fsTransmitDual`). */
export const dualSource = (device: GPUDevice) =>
  device.features?.has('dual-source-blending') === true

/** The front stage's pipelines of what a front pass writes (`frontStage.ts`): its three culls, picked by
 *  a plan rank's cull, whether they are compiled, and their compile asked. */
export type FrontStagePipelines = RankedPipelines & {
  readonly ready: boolean
  ask(): void
  prepare(): Promise<unknown>
}

/** What a transparent pass compiles per blending mode (`BLEND_MODES`): each mode's pipelines, one
 *  per descriptor its `describe` gives, prepared off the frame (`preparedPipeline`). `precompile`
 *  compiles modes without blocking the thread; `at` gives a mode's pipeline at `rank` of its
 *  descriptors, and a pipeline nothing prepared is made by the draw that asks for it, alone, once:
 *  a blending written later draws in its own mode at once, its other pipelines compiling off the
 *  thread from that draw on. */
export interface ModePipelines {
  at(mode: Blending, rank: number): GPURenderPipeline
  precompile(modes: readonly Blending[]): Promise<void>
}

/** The transparent pass's lazy set: its three culls per mode. A mode's descriptors are described
 *  once, at its first use. */
export function pipelinesByMode(
  device: GPUDevice,
  describe: (mode: Blending) => readonly GPURenderPipelineDescriptor[],
): ModePipelines {
  const byMode: (readonly ReturnType<typeof preparedPipeline>[] | undefined)[] = []
  const of = (mode: Blending) =>
    (byMode[BLEND_MODES.indexOf(mode)] ??= describe(mode).map((descriptor) =>
      preparedPipeline(device, descriptor),
    ))
  return {
    at(mode, rank) {
      const first = !byMode[BLEND_MODES.indexOf(mode)],
        set = of(mode)
      // A mode a draw describes first: its other pipelines start off the thread, once.
      if (first) for (const [at, pipeline] of set.entries()) if (at !== rank) started(pipeline)
      return set[rank].get()
    },
    async precompile(modes) {
      await Promise.all(modes.flatMap((mode) => of(mode).map((pipeline) => pipeline.prepare())))
    },
  }
}

/** Normal as soon as a transparent item exists — a transmissive one draws in it under a diagnostic
 *  variant —, then every mode a blend item declares: what the transparent pass compiles up front. A scene of plain glass
 *  compiles normal alone; one with no transparent item compiles no blend program, a mode
 *  asked later compiles at its first draw (`at`). */
export const declaredBlendModes = (
  items: readonly Pick<BlendGpuItem, 'surface' | 'transmissive'>[],
) =>
  BLEND_MODES.filter(
    (mode, rank) =>
      (!rank && items.length > 0) ||
      items.some((item) => !item.transmissive && item.surface.blending === mode),
  )

/** The blend pass's pipelines by plan rank — mode rank × 3 + cull rank, then the transmissive
 *  items' three (`plan/plan.ts`) —, read from its `ModePipelines`, each mode's three culls, and its
 *  `TransmitPipelines`. */
export interface BlendModePipelines extends RankedPipelines {
  /** The display mask's, whose target is attachment `slot` (`routedPipelines.ts`). */
  readonly mask: RankedPipelines & { slot: number }
  /** The front stage's of what a front pass writes (`FrontOutputs`), one set each, every program's
   *  the same (`frontPass.ts`). */
  front(outputs: FrontOutputs): FrontStagePipelines
  /** What the program draws its transmissive items with, none in a scene that transmits nothing
   *  or under a diagnostic variant (`TransmitPipelines`). */
  readonly transmission?: TransmitPipelines
  /** The colour and companion passes under the dual blend, where the transmissive items blend dual
   *  (`createDualPasses`). */
  readonly dualPasses?: DualPasses
  /** The ids of the graph programs its modules hold the functions of (`programOf`, `blendGraphs`): a
   *  surface whose graph is none of them is drawn by a program built again (`grantGraphs`). */
  readonly graphs?: readonly number[]
  /** The pipelines of the program a frame of the lights' key `key` is lit with, its items `lobed`
   *  or not (`createForwardVariants`). */
  lit(key: Partial<ContractKey>, lobed: boolean): BlendModePipelines
  /** The compile a frame of lobed items waits for while no program with the lobe code is ready:
   *  the one with every code path, which lights any (`askLobedPrograms`). */
  lobedAwaited(): Promise<unknown> | undefined
  /** Starts the compile of what a change of the scene or of a setting now reaches (`reach.ts`). */
  reach(next: { modes?: readonly Blending[]; share?: ShareTargets; filtered?: boolean }): void
  at(rank: number, filtered?: boolean, share?: ShareTargets): GPURenderPipeline
}

/** The groups after the blend's of a stage that reads the reflection (`REFLECTION_GROUP`), the
 *  display mask's last where `mask` is given: what `stageDescriptors` is handed by every stage but
 *  the front's and those with groups of their own. */
export const reflectedGroups = (device: GPUDevice, mask?: GPUBindGroupLayout) =>
  mask ? [reflectionLayout(device), mask] : [reflectionLayout(device)]

/** The three cull modes of one fragment stage of the blend module, on the blend bind group layout
 *  then `groups` — the reflection's and the mask's (`reflectedGroups`), a stage's own, or none for
 *  the front stage (`frontStage.ts`) —, `depthWrite` or not, one descriptor per cull mode: what a
 *  blend mode compiles. Same vertex stage, same rank picks the same side. Every stage takes one
 *  translucent depth state — tested near or equal, no bias, the distortion's and the front layer
 *  pass's alike —, so the depth the front stage stores is the one a forward fragment's position
 *  carries, which the front test compares within `FRONT_DEPTH_THRESHOLD` units
 *  (`frontDepthMatches`). */
export function stageDescriptors(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  fragment: GPUFragmentState,
  depthWrite: boolean,
  groups: readonly GPUBindGroupLayout[],
): GPURenderPipelineDescriptor[] {
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout, ...groups] })
  return CULL_MODES.map((cullMode) => ({
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'vs' },
    fragment,
    primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: depthWrite,
      depthCompare: DEPTH_COMPARE_OR_EQUAL,
    },
  }))
}
