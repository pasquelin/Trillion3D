import { gpuCapsOf } from '../gpu/core/gpuCaps.ts'
import { reflectionForwardLayout } from '../lighting/reflections/reflectionPipelines.ts'
import { REFLECTION_LIGHT_VIEW_BINDING } from '../lighting/reflections/viewLayout.ts'
import type { FrontOutputs } from '../lighting/reflections/frontLayer.ts'
import { DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts'
import {
  pipelineLayoutOf,
  preparedPipeline,
  type PreparedPipeline,
} from '../lighting/deferred/fullscreen.ts'
import { blendLightingConstant, blendLightingOf } from '../materials/surface/blendLightSource.ts'
import { blendModeConstant } from '../materials/surface/materialBlending.ts'
import { feedbackConstants } from '../materials/virtual/requestWgsl.ts'
import { blendTargets } from './blendTargets.ts'
import type { BlendGpuItem } from './state.ts'
import type { ContractKey } from '../lighting/deferred/contractCuts.ts'
import type { TranslucentMaterialShadow } from '../lighting/direct/shadowWgsl.ts'
import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import {
  CULL_MODES,
  modulatesRank,
  transmitsRank,
  variantBlending,
  variantLighting,
  variantOfBlend,
} from './plan/planCull.ts'
import type { DualPasses } from './pipelines.ts'
import type { VertexReads } from './cloudVertexText.ts'
import type { TranslucentScene } from './shader.ts'
import type { WaterPipelines } from './water/waterPipelines.ts'

/** Pipelines a transparent pass picks by plan rank (`draw.ts`): the blend pass's modes and
 *  transmissive culls, `filtered` in an image with display layers (`display/displayFilter.ts`); a rank
 *  the pass `skips` is not drawn (the display mask draws the filtering modes alone, the distortion
 *  the transmissive items alone). */
export type RankedPipelines = {
  at(rank: number, filtered?: boolean): GPURenderPipeline | undefined
  skips?(rank: number): boolean
}

/** The ranks a pass of one target draws: the translucency target's — every mode that adds to it, the
 *  transmissive layers —, the modulation target's — the modes that multiply the scene. */
type TargetRanks = 'translucency' | 'modulation'
const RANKS_OF: Record<TargetRanks, (rank: number) => boolean> = {
  translucency: (rank) => !modulatesRank(rank),
  modulation: modulatesRank,
}
const restrictions = new WeakMap<RankedPipelines, Partial<Record<TargetRanks, RankedPipelines>>>()
/** `set` drawing the ranks of `target` alone, made once for a set and a target. */
export function onTarget(set: RankedPipelines, target: TargetRanks): RankedPipelines {
  let made = restrictions.get(set)
  if (!made) restrictions.set(set, (made = {}))
  return (made[target] ??= {
    at: (rank, filtered) => set.at(rank, filtered),
    skips: (rank) => !!set.skips?.(rank) || !RANKS_OF[target](rank),
  })
}

/**
 * What a blend program draws its transmissive items with (`./transmission/pipelines.ts`), each set picked
 * by a plan rank's cull past the blend modes' (`TRANSMIT_BASE`): the layer under the single-source
 * fallback on the blend pass's targets (`over`), under its dual blend on the translucency target
 * alone (`dual`, none on a device without `dual-source-blending`) and on the modulation target
 * (`dualModulate`, the request beside it), the request alone of the layers that pass multiplies
 * nothing by (`coverage`), the responsiveness pass (`responsive`), the distortion's accumulation — of the refracting ranks
 * alone (`distortion`), on the blend group and its own (`distortionGroup`) — and its
 * full-screen application (`apply`, on an empty group 0, `applyEmpty`, and its own, `applyGroup`);
 * then the compile of what the scene reaches (`precompile`).
 */
export interface TransmitPipelines {
  readonly over: RankedPipelines
  readonly dual?: RankedPipelines
  readonly dualModulate?: RankedPipelines
  readonly coverage: RankedPipelines
  readonly responsive: RankedPipelines
  /** The alpha holdout's accumulation (`holdout.ts`). */
  readonly holdout: RankedPipelines
  readonly distortion: RankedPipelines
  readonly apply: PreparedPipeline<GPURenderPipeline>
  /** The distortion's whole chain, its accumulation's culls then its application (`chainReady`). */
  distortionChain(): PreparedPipeline<unknown>[]
  readonly applyEmpty: GPUBindGroup
  distortionGroup(view: GPUBuffer, depth: GPUTextureView): GPUBindGroup
  applyGroup(view: GPUBuffer, offsets: GPUTextureView, scene: GPUTextureView): GPUBindGroup
  precompile(reached: {
    responsive: boolean
    refracts: boolean
    chromatic: boolean
    filtered: boolean
    holdout: boolean
  }): Promise<unknown>
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
export const dualSource = (device: GPUDevice) => gpuCapsOf(device).dualSource

/** The front stage's pipelines of what a front pass writes (`frontStage.ts`): its three culls, picked by
 *  a plan rank's cull, whether they are compiled, and their compile asked. */
export type FrontStagePipelines = RankedPipelines & {
  readonly ready: boolean
  ask(): void
  prepare(): Promise<unknown>
}

/** What a transparent pass compiles per blend variant (`variantOf`: a blending mode in a lighting program): each
 *  variant's pipelines, one per descriptor its `describe` gives, prepared off the frame (`preparedPipeline`).
 *  `precompile` compiles variants without blocking the thread, `ask` compiles them with the frames
 *  waiting (`pipelinesCompiling`); `at` gives a variant's pipeline at `rank` of its descriptors, none
 *  until it is compiled: a pipeline nothing asked is asked by the draw that needs it, which is skipped
 *  meanwhile. */
export interface VariantPipelines {
  at(variant: number, rank: number): GPURenderPipeline | undefined
  precompile(variants: Iterable<number>): Promise<void>
  ask(variants: Iterable<number>): void
}

/** The blend modes' pipelines by variant on `module`, the stage `stage` drawing them, three culls each:
 *  every target of the pass — the translucency or modulation target, the request where `feedback`
 *  writes it —, or with `single` the first alone, the pass under the dual blend holding one attachment,
 *  and with `single` and `feedback` the first and the request. */
export function modePipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  { entryPoint, writeMask }: { entryPoint: string; writeMask: GPUColorWriteFlags },
  feedback: boolean,
  single = false,
) {
  return pipelinesByVariant(device, (variant) => {
    const mode = variantBlending(variant)!
    const targets = blendTargets(mode, writeMask, feedback)
    return stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint,
        constants: {
          ...feedbackConstants(feedback),
          ...blendModeConstant(mode),
          ...blendLightingConstant(variantLighting(variant)),
        },
        targets: single ? targets.slice(0, feedback ? 2 : 1) : targets,
      },
      false,
      reflectedGroups(device),
    )
  })
}

/** The transparent pass's lazy set: its three culls per variant. A variant's descriptors are described
 *  once, at its first use. */
export function pipelinesByVariant(
  device: GPUDevice,
  describe: (variant: number) => readonly GPURenderPipelineDescriptor[],
): VariantPipelines {
  const byVariant: (readonly ReturnType<typeof preparedPipeline>[] | undefined)[] = []
  const of = (variant: number) =>
    (byVariant[variant] ??= describe(variant).map((descriptor) =>
      preparedPipeline(device, descriptor),
    ))
  return {
    at: (variant, rank) => of(variant)[rank].get(),
    ask(variants) {
      for (const variant of variants) for (const pipeline of of(variant)) pipeline.ask()
    },
    async precompile(variants) {
      await Promise.all(
        [...variants].flatMap((variant) => of(variant).map((pipeline) => pipeline.prepare())),
      )
    },
  }
}

/** Normal in the forward lighting as soon as a transmissive item exists — it draws in it under a diagnostic variant —,
 *  then every variant a non-transmissive item draws (`variantOf`): what the transparent pass compiles up front. A scene of plain glass
 *  compiles that one alone; one with no transparent item compiles no blend program, a variant
 *  asked later compiles at its first draw (`at`). */
export const declaredBlendVariants = (
  items: readonly Pick<BlendGpuItem, 'surface' | 'transmissive'>[],
) => {
  const declared = new Set<number>()
  for (const item of items)
    declared.add(
      item.transmissive
        ? variantOfBlend('normal', 'forward')
        : variantOfBlend(item.surface.blending ?? 'normal', blendLightingOf(item)),
    )
  return [...declared].sort((a, b) => a - b)
}

/** The blend pass's pipelines by plan rank — variant rank × 3 + cull rank, then the transmissive
 *  items' three (`plan/plan.ts`) —, read from its `ModePipelines`, each mode's three culls, and its
 *  `TransmitPipelines`. */
export interface BlendModePipelines extends RankedPipelines {
  /** The display mask's, whose target is attachment `slot` (`routedPipelines.ts`). */
  readonly mask: RankedPipelines & { slot: number }
  /** The front stage's of what a front pass writes (`FrontOutputs`), one set each, every program's
   *  the same (`frontPass.ts`). */
  front(outputs: FrontOutputs): FrontStagePipelines
  /** The radiance mark stage's, every program's the same (`radianceMark.ts`). */
  readonly radianceMark: FrontStagePipelines
  /** What the program draws its transmissive items with, none in a scene that transmits nothing
   *  or under a diagnostic variant (`TransmitPipelines`). */
  readonly transmission?: TransmitPipelines
  /** What the program draws its single-layer water with, none in a scene with no water
   *  (`WaterPipelines`). */
  readonly water?: WaterPipelines
  /** The colour and modulation passes under the dual blend, where the transmissive items blend dual
   *  (`createDualPasses`). */
  readonly dualPasses?: DualPasses
  /** The ids of the graph programs its modules hold the functions of (`programOf`, `blendGraphs`): a
   *  surface whose graph is none of them is drawn by a program built again (`grantGraphs`). */
  readonly graphs?: readonly number[]
  /** What its modules' vertex stage reads (`VertexReads`): the clouds' shade and, for the surfaces whose
   *  material has `cloudFog`, the cloud image, and the fog per vertex (`fogVertexOf`): a surface of
   *  that kind drawn by a program that does not read it is drawn by one built again (`grantGraphs`). */
  readonly reads?: VertexReads
  /** What its modules' lights were made for (`TranslucentScene`): whether they hold the contact shadows' code, for the
   *  surfaces whose material asks, a surface of that kind drawn by a program that does not being drawn by one built again
   *  (`grantGraphs`). */
  readonly scene?: TranslucentScene
  /** Whether its modules read the translucency lighting volume, for the surfaces whose material is
   *  lit from it: a surface of that kind drawn by a program that does not is drawn by one built
   *  again (`grantGraphs`). */
  readonly translucencyVolume?: boolean
  /** What some surface asked of its own about the shadows its fragments read when its modules were
   *  made, which they hold the code of (`translucentShadowOf`): a surface asking more is drawn by a
   *  program built again (`grantGraphs`). */
  readonly translucentShadow?: TranslucentMaterialShadow
  /** The pipelines of the program a frame of the lights' key `key` is lit with, its items `lobed`
   *  or not (`createForwardVariants`); none while the program that serves it compiles: the pass is
   *  skipped, the frame held for it (`litAwaited`). */
  lit(key: Partial<ContractKey>, lobed: boolean): BlendModePipelines | undefined
  /** The compile a frame of `key` waits for while no ready program serves it, asked now. */
  litAwaited(key: Partial<ContractKey>, lobed: boolean): Promise<unknown> | undefined
  /** Starts the compile of what a change of the scene or of a setting now reaches (`reach.ts`). */
  reach(next: {
    variants?: readonly number[]
    responsive?: boolean
    refracts?: boolean
    chromatic?: boolean
    filtered?: boolean
    holdout?: boolean
  }): void
  /** The responsiveness pass's, the layers' marks in their own target (`drawResponsive`). */
  readonly responsive: RankedPipelines
  /** The alpha holdout's, what each layer leaves of the background visible, in a target of its own
   *  (`drawHoldout`). */
  readonly holdout: RankedPipelines
}

/** The groups after the blend's of a stage that reads the reflection (`REFLECTION_GROUP`), the
 *  display mask's last where `mask` is given: what `stageDescriptors` is handed by every stage but
 *  the front's and those with groups of their own. */
export const reflectedGroups = (device: GPUDevice, mask?: GPUBindGroupLayout) =>
  mask ? [reflectionForwardLayout(device), mask] : [reflectionForwardLayout(device)]

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
  depth: Pick<GPUDepthStencilState, 'format' | 'depthCompare'> = {
    format: DEPTH_FORMAT,
    depthCompare: DEPTH_COMPARE_OR_EQUAL,
  },
): GPURenderPipelineDescriptor[] {
  const pipelineLayout = pipelineLayoutOf(device, [layout, ...groups])
  return CULL_MODES.map((cullMode) => ({
    layout: pipelineLayout,
    vertex: { module, entryPoint: 'vs' },
    fragment,
    primitive: { topology: 'triangle-list', cullMode, frontFace: 'ccw' },
    depthStencil: { ...depth, depthWriteEnabled: depthWrite },
  }))
}

/** `stageDescriptors` of a stage that draws no depth, each cull made a pipeline. */
export const cullPipelines = (
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  fragment: GPUFragmentState,
  groups: readonly GPUBindGroupLayout[],
) =>
  stageDescriptors(device, module, layout, fragment, false, groups).map((descriptor) =>
    preparedPipeline(device, descriptor),
  )

/** The pipeline of a stage both kinds of layer draw (request, responsiveness, holdout) by a plan
 *  rank: `transmitted`, the transmissive stage's where the rank is a transmissive one, else the
 *  blends' `blends`. */
export const ofLayerKind = (
  transmitted: ((rank: number) => GPURenderPipeline | undefined) | undefined,
  blends: (rank: number) => GPURenderPipeline | undefined,
): Pick<RankedPipelines, 'at'> => ({
  at: (rank) => (transmitted && transmitsRank(rank) ? transmitted(rank) : blends(rank)),
})
