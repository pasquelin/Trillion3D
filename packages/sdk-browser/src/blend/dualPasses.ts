import {
  cullPipelines,
  modePipelines,
  reflectedGroups,
  type BlendModePipelines,
  type RankedPipelines,
  type TransmitPipelines,
} from './stagePipelines.ts'
import {
  chromaRank,
  cullOf,
  modulatesRank,
  transmitsRank,
  variantBlending,
  variantOf,
} from './plan/planCull.ts'
import type { Reach } from './reach.ts'
import { feedbackConstants } from '../materials/virtual/requestWgsl.ts'
import { marksTargets } from './blendTargets.ts'
import { modulatesScene } from '../materials/surface/materialBlending.ts'

/** The request stage of the blends the modulation pass multiplies nothing by, made at its first ask. */
function requestPipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback: boolean,
) {
  let covered: ReturnType<typeof cullPipelines> | undefined
  return () =>
    (covered ??= cullPipelines(
      device,
      module,
      layout,
      {
        module,
        entryPoint: 'fsBlendCoverage',
        constants: feedbackConstants(feedback),
        targets: marksTargets(),
      },
      reflectedGroups(device),
    ))
}

/**
 * The blend pass's passes under the dual blend (`drawBlendPass`), on a program's `module`:
 * the colour pass on the translucency target alone — the blends in their modes with no other target and no
 * request computed, the transmissive layers dual (`colour`) — and the pass on the modulation target
 * (`modulate`). Where the pipelines write the virtual-texture feedback the colour pass cannot — a dual blend
 * holds one target — the modulation pass draws EVERY layer and writes it: the modes that multiply the
 * scene and the chromatic layers by their multiplication with the request beside it, the others by the request
 * alone, the modulation target's write mask empty; without feedback it draws the multiplying layers alone. With no transmissive item in view, the one pass on
 * every target (`blends`). Each pipeline made at its first use or by `precompile`.
 */
export function createDualPasses(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  stage: { entryPoint: string; writeMask: GPUColorWriteFlags },
  feedback: boolean,
  transmission: TransmitPipelines,
  at: BlendModePipelines['at'],
) {
  const dual = transmission.dual!,
    dualModulate = transmission.dualModulate!
  const colourSet = modePipelines(device, module, layout, stage, false, true)
  const modulateSet = feedback
    ? modePipelines(device, module, layout, stage, true, true)
    : colourSet
  const requestOf = requestPipelines(device, module, layout, feedback)
  /** The ranks of `layers` (the transmissive layers' pipelines) and the blends' `blends` of the rest. */
  const ranked =
    (
      layers: (rank: number) => GPURenderPipeline | undefined,
      blends: (rank: number) => GPURenderPipeline | undefined,
    ) =>
    (rank: number) => (transmitsRank(rank) ? layers(rank) : blends(rank))
  const colourAt = ranked(dual.at, (rank) => colourSet.at(variantOf(rank), cullOf(rank)))
  const modulateAt = ranked(
    (rank) => (chromaRank(rank) ? dualModulate : transmission.coverage).at(rank),
    (rank) =>
      modulatesRank(rank)
        ? modulateSet.at(variantOf(rank), cullOf(rank))
        : requestOf()[cullOf(rank)].get(),
  )
  return {
    colour: { at: colourAt } satisfies RankedPipelines,
    /** The pass on the modulation target: the layers that multiply the scene, the chromatic ones by what they
     *  transmit, and with feedback every other layer for its request. */
    modulate: {
      at: modulateAt,
      skips: feedback ? undefined : (rank) => !(modulatesRank(rank) || chromaRank(rank)),
    } satisfies RankedPipelines,
    /** The one pass on every target of an image whose transmissive items are out of view: the
     *  program's own pipelines (\`at\`), the transmissive slots skipped. */
    blends: { at, skips: transmitsRank } satisfies RankedPipelines,
    /** What the scene reaches compiles off the frame, where it holds a chromatic layer (the only one
     *  that takes these passes): its variants' colour pipelines, the modulation pass's where it
     *  writes feedback. */
    precompile: ({ variants, chromatic }: Reach['state']) =>
      chromatic
        ? Promise.all([
            colourSet.precompile(variants),
            ...(feedback
              ? [
                  modulateSet.precompile(
                    [...variants].filter((variant) => modulatesScene(variantBlending(variant))),
                  ),
                  ...requestOf().map((pipeline) => pipeline.prepare()),
                ]
              : []),
          ])
        : Promise.resolve([]),
  }
}

/** The blend pass's passes under the dual blend (`createDualPasses`). */
export type DualPasses = ReturnType<typeof createDualPasses>
