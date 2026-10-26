import { feedbackConstants } from '../../materials/virtual/requestWgsl.ts'
import { preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { cullPipelines, reflectedGroups, type TransmitPipelines } from '../stagePipelines.ts'
import { chromaRank, cullOf, refractsRank, transmitsRank } from '../plan/planCull.ts'
import { displayMaskLayout } from '../display/displayFilter.ts'
import { layerOnlyTargets, marksTargets, overTargets } from '../blendTargets.ts'
import { RESPONSIVE_TARGET } from '../responsive.ts'
import { HOLDOUT_TARGET } from '../holdout.ts'
import { ADD_ONE, KEEP } from '../equations.ts'
import { DISTORTION_FORMAT, FEEDBACK_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'
import { distortionApply, distortionLayout, emptyGroup } from './distortionGroups.ts'

/** The dual blend on the translucency target, of a layer whose transmittance differs by channel
 *  (`chromaRank`): the first source added, the destination multiplied by the second; the
 *  transmittance left as it is — the scene behind is multiplied on the modulation target
 *  (`MODULATE`). A layer that transmits all channels alike is one blend over, as the others. */
const DUAL_BLEND: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'src1' }, alpha: KEEP }
/** The blend on the modulation target: the destination multiplied by the layer's own colour, nothing
 *  added, the target's alpha left as it is (`translucency.ts`). */
const MODULATE: GPUBlendState = {
  color: { srcFactor: 'zero', dstFactor: 'src' },
  alpha: KEEP,
}
/** The distortion accumulation: every refracting layer's offset added. */
const ACCUMULATE: GPUBlendState = { color: ADD_ONE, alpha: ADD_ONE }
/** The offsets' target, every accumulation's. */
const DISTORTION_TARGET: GPUColorTargetState = { format: DISTORTION_FORMAT, blend: ACCUMULATE }

/** The constants of a pipeline that computes no request. */
const NO_FEEDBACK = feedbackConstants(false)

/** A stage's three culls, compiled at their first use or by `precompile`. */
type Culls = ReturnType<typeof preparedPipeline>[]

/** The pipelines a plan rank of a transmissive item picks of `culls`: its cull's; every rank `drawn`
 *  refuses is skipped (\`transmitsRank\` unless given). */
const ranked = (
  culls: () => Culls,
  drawn: (rank: number) => boolean = transmitsRank,
): TransmitPipelines['coverage'] => ({
  at: (rank) => culls()[cullOf(rank)].get(),
  skips: (rank) => !drawn(rank),
})

/** The lazily compiled cull sets of one blend program's transmissive stages. */
interface TransmitStages {
  overOf: (filtered: boolean) => Culls
  dualOf: () => Culls
  greyOf: () => Culls
  modulateOf: () => Culls
  coverageOf: () => Culls
  responsiveOf: () => Culls
  holdoutOf: () => Culls
  distortionOf: () => Culls
}

/** `make`, run at the first call and its result kept. */
function lazy<T>(make: () => T): () => T {
  let made: T | undefined
  return () => (made ??= make())
}

/** The stages' cull sets of the blend program on `module`, each compiled at its first use. */
function transmitStages(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback: boolean,
): TransmitStages {
  const culls = (
    entryPoint: string,
    targets: (GPUColorTargetState | null)[],
    groups: { mask?: GPUBindGroupLayout; own?: GPUBindGroupLayout[]; route?: boolean } = {},
    constants = feedbackConstants(feedback),
  ): Culls =>
    cullPipelines(
      device,
      module,
      layout,
      {
        module,
        entryPoint,
        targets,
        constants: groups.route ? { ...constants, DISPLAY_ROUTE: 1 } : constants,
      },
      groups.own ?? reflectedGroups(device, groups.mask),
    )
  // The fallback by display layers (`+filtered`).
  const plain = lazy(() => culls('fsTransmit', overTargets(feedback, false)))
  const filtered = lazy(() =>
    culls('fsTransmitFiltered', overTargets(feedback, true), {
      mask: displayMaskLayout(device),
      route: true,
    }),
  )
  const own = () => ({ own: [distortionLayout(device)] })
  return {
    overOf: (isFiltered) => (isFiltered ? filtered() : plain()),
    // The passes of one target, under the dual blend: no request computed (the modulation pass holds it).
    dualOf: lazy(() =>
      culls('fsTransmitDual', [{ format: HDR_FORMAT, blend: DUAL_BLEND }], {}, NO_FEEDBACK),
    ),
    greyOf: lazy(() => culls('fsTransmit', layerOnlyTargets(), {}, NO_FEEDBACK)),
    // The modulation pass's: the multiply on its target, the request beside it where the pipelines write one.
    modulateOf: lazy(() =>
      culls('fsTransmitModulate', [
        { format: HDR_FORMAT, blend: MODULATE },
        ...(feedback ? [{ format: FEEDBACK_FORMAT }] : []),
      ]),
    ),
    // The request of a layer the modulation pass multiplies nothing by (`marksTargets`).
    coverageOf: lazy(() => culls('fsTransmitCoverage', marksTargets(), { own: [] })),
    // The responsiveness pass: its one target, no light, no feedback.
    responsiveOf: lazy(() => culls('fsTransmitResponsive', [RESPONSIVE_TARGET], { own: [] })),
    // The alpha holdout's accumulation: its one target, no light, no feedback, made at its first image.
    holdoutOf: lazy(() => culls('fsTransmitHoldout', [HOLDOUT_TARGET], { own: [] })),
    distortionOf: lazy(() => culls('fsDistortion', [DISTORTION_TARGET], own())),
  }
}

/** The colour pass's reached sets — with a chromatic layer under the dual blend the dual blend itself,
 *  the modulation pass's multiply and the blend over on its one target, the single-source fallback on every
 *  target otherwise and wherever display layers are on —, the responsiveness pass's where it is
 *  drawn, then with `unlit` the request stage of the modulation pass where the pipelines write one. */
function reachedSets(
  stages: TransmitStages,
  dual: boolean,
  {
    responsive,
    filtered,
    chromatic,
    holdout,
  }: { responsive: boolean; filtered: boolean; chromatic: boolean; holdout: boolean },
  unlit: boolean,
  feedback: boolean,
) {
  const split = dual && chromatic
  const sets: Culls[] = split
    ? [stages.dualOf(), stages.greyOf(), stages.modulateOf()]
    : [stages.overOf(false)]
  if (split && unlit && feedback) sets.push(stages.coverageOf())
  if (unlit && responsive) sets.push(stages.responsiveOf())
  if (unlit && holdout) sets.push(stages.holdoutOf())
  if (filtered) sets.push(stages.overOf(true))
  return sets.flat().map((pipeline) => pipeline.prepare())
}

/**
 * The transmissive pipelines of one blend program (`TransmitPipelines`), on its `module` — the
 * blend module, its transmissive stages in it (`transmitWgsl.ts`) — and the blend group's
 * `layout`, each made at its first use or by `precompile`; `dual`, the device grants
 * `dual-source-blending` and the module holds `fsTransmitDual` and `fsTransmitModulate`. The groups a frame binds are made
 * again only when what they name moved (`createWebgpuBindIdentity`).
 *
 * Only the layer's colour lights: the request stage and the distortion's passes read no light,
 * so the programs of other lights take them from `shared`, the first program's of their lobes
 * (`../pipelines.ts`) — made once, not once per program.
 */
export function createTransmitPipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  feedback: boolean,
  dual: boolean,
  shared?: TransmitPipelines,
): TransmitPipelines {
  const stages = transmitStages(device, module, layout, feedback)
  const { overOf, dualOf, greyOf, modulateOf, distortionOf } = stages
  const over: TransmitPipelines['over'] = {
    at: (rank, filtered = false) => overOf(filtered)[cullOf(rank)].get(),
  }
  // The colour pass under the dual blend: a chromatic layer dual, any other one blend over on the
  // same target; the modulation pass draws the chromatic layers alone.
  const chromatic = ranked(dualOf, chromaRank),
    grey = ranked(greyOf, (rank) => transmitsRank(rank) && !chromaRank(rank))
  const colour: NonNullable<TransmitPipelines['dual']> = {
    at: (rank) => (chromaRank(rank) ? chromatic : grey).at(rank),
    skips: (rank) => !transmitsRank(rank),
  }
  const modulate = ranked(modulateOf, chromaRank)
  if (shared)
    return {
      ...shared,
      over,
      dual: dual ? colour : undefined,
      dualModulate: dual ? modulate : undefined,
      /** The colour pass's here, the stages it shares with `shared`. */
      precompile: (reached) =>
        Promise.all([
          shared.precompile(reached),
          ...reachedSets(stages, dual, reached, false, feedback),
        ]),
    }
  const { apply, distortionGroup, applyGroup } = distortionApply(
    device,
    module,
    feedbackConstants(feedback),
  )
  return {
    over,
    dual: dual ? colour : undefined,
    dualModulate: dual ? modulate : undefined,
    coverage: ranked(stages.coverageOf),
    responsive: ranked(stages.responsiveOf),
    holdout: ranked(stages.holdoutOf),
    distortion: ranked(distortionOf, refractsRank),
    apply,
    distortionChain: () => [...distortionOf(), apply],
    applyEmpty: emptyGroup(device),
    distortionGroup,
    applyGroup,
    /** What the scene reaches compiles off the frame: the colour pass's, the modulation pass's request
     *  stage, the responsiveness pass's, and where an item refracts the distortion's accumulation and
     *  application. */
    precompile: (reached) =>
      Promise.all([
        ...(reached.refracts
          ? [apply.prepare(), ...distortionOf().map((pipeline) => pipeline.prepare())]
          : []),
        ...reachedSets(stages, dual, reached, true, feedback),
      ]),
  }
}
