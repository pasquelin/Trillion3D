import { blendShader } from './shader.ts'
import type { BlendGpuItem } from './state.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import { blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import {
  declaredBlendModes,
  dualSource,
  pipelinesByMode,
  reflectedGroups,
  stageDescriptors,
  type BlendModePipelines,
  type RankedPipelines,
  type TransmitPipelines,
} from './stagePipelines.ts'
import { blendingOf, cullOf, transmitsRank } from './plan/planCull.ts'
import { createRoutedPipelines } from './routedPipelines.ts'
import { createReach, type Reach } from './reach.ts'
import { filtersDisplay } from './equations.ts'
import { blendCatchUp } from './blendCatchUp.ts'
import { families } from '../session/host/families.ts'
import { hasSubgroups } from '../gpu/core/subgroups.ts'
import {
  blendVariantPipeline,
  DIAGNOSTIC_BLEND_WGSL,
  type DiagnosticGpuVariant,
} from '../diagnostic/gpuVariant.ts'
import { feedbackConstants } from '../materials/virtual/requestWgsl.ts'
import {
  blendTargets,
  companionTargets,
  SHARE_TARGET_KEYS,
  type ShareTargets,
} from './blendTargets.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { createFrontStages, prepareFrontStage } from './frontStage.ts'
import { createForwardVariants, type ForwardLit } from '../lighting/deferred/forwardVariants.ts'
import { FULL_CONTRACT, variantLabel, type ContractKey } from '../lighting/deferred/contractCuts.ts'

/** What the pass reads of an item to be drawn: its surface, and whether it transmits. */
export type BlendedSurface = Pick<BlendGpuItem, 'surface' | 'transmissive'>

/** A blend program: its module, and the pipelines drawn with it. */
type BlendProgram = { module: GPUShaderModule; pipelines: BlendModePipelines }

/** The transmission code a scene that transmits imports (`families.transmission`). */
type TransmissionCode = Awaited<ReturnType<typeof families.transmission.load>>

/** What every blend program of a pass is compiled with. */
type BlendProgramSetup = {
  device: GPUDevice
  layout: GPUBindGroupLayout
  transmissionCode: TransmissionCode | undefined
  variant: DiagnosticGpuVariant | undefined
  feedback: boolean
  share: ShareTargets
  reach: Reach
  /** The pass's lit programs, once made: what a frame's pick reads. */
  programs: () => ForwardVariants<BlendProgram>
  /** The front stages every program draws its front pass with (`createFrontStages`). */
  front: ReturnType<typeof createFrontStages>
  /** The first program's transmissive pipelines of each lobe choice, lobed then lobeless: what
   *  the others take their unlit stages from (`createTransmitPipelines`). */
  transmitted: (TransmitPipelines | undefined)[]
}
type ForwardVariants<P> = Awaited<ReturnType<typeof createForwardVariants<P>>>

/** Builds the forward-material pipelines for transparent draws, the transmissive stages of a
 *  scene that transmits among them. They light with the code the scene's lights need, as the
 *  opaque resolve (`createForwardVariants`): `lit`, the key their first frame asks for. */
export async function createWebgpuBlendPipelines(
  device: GPUDevice,
  items: readonly BlendedSurface[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
  share: ShareTargets = 0,
  { lit, holdsTransmission }: { lit?: ForwardLit; holdsTransmission?: boolean } = {},
) {
  // The forward materials' layout, which the feedback-free diagnostic pipelines share: the
  // group's table (`blendLayoutEntries`), the view uniform at its size.
  const blendBindGroupLayout =
    sharedLayout ?? device.createBindGroupLayout({ entries: blendLayoutEntries(BLEND_VIEW_SIZE) })
  // The transmissive stages exist for a scene that transmits, outside any diagnostic variant:
  // under one, a transmissive item draws as one more blend, the same fragment stage measured on
  // all. A session that holds one (`holdsTransmission`) builds them whatever its items: one granted
  // for copies that have not joined yet (`growth.ts`).
  const transmits = !variant && (!!holdsTransmission || items.some((item) => item.transmissive))
  // Their code, transmission's, is imported by the first scene that transmits, and awaited here as
  // the scene's other resources are, before any frame (#1353). An import that could not load is
  // the scene's refusal (`FAMILY_LOAD_FAILED`), never a scene without its transmission.
  const transmissionCode = transmits ? await families.transmission.load() : undefined
  // What the scene's materials and settings reach now (`reach.ts`): normal with any item (a
  // transmissive item draws on it under a diagnostic), every mode an item declares, the share set
  // drawn now, the display layers when a mode filters. A change compiles its own, off the frame.
  // No item, no blend program (#1362).
  const declared = declaredBlendModes(items)
  const reach = createReach({
    modes: declared,
    share,
    filtered: !variant && declared.some(filtersDisplay),
  })
  const setup: BlendProgramSetup = {
    device,
    layout: blendBindGroupLayout,
    transmissionCode,
    variant,
    feedback,
    share,
    reach,
    programs: () => programs,
    front: createFrontStages(device, blendBindGroupLayout),
    transmitted: [],
  }
  const programs = await createForwardVariants((key) => blendProgram(setup, key), lit)
  await prepareFrontStage(setup.front, items)
  return { blendBindGroupLayout, blendPipelines: programs.twin.pipelines }
}

/** The blend module's text lit with the code `key` leaves in, with the transmissive stages of a
 *  scene that transmits — the dual blend among them where the device grants it. */
function blendModuleCode(setup: BlendProgramSetup, key: ContractKey) {
  const { transmissionCode, variant, device } = setup
  const dual = !!transmissionCode && dualSource(device)
  return blendShader(key, {
    stage: transmissionCode?.transmitWgsl(key, dual),
    diagnostic: variant ? DIAGNOSTIC_BLEND_WGSL : undefined,
    dual,
    subgroups: hasSubgroups(device),
  })
}

/** The module lit with the code `key` leaves in, and its pipelines: a lazy set by share-target key
 *  (#365, `ShareTargets`), a slot the key leaves out empty, no target bound. */
async function blendProgram(setup: BlendProgramSetup, key: ContractKey): Promise<BlendProgram> {
  const { device, layout, variant, feedback, share, reach, transmissionCode } = setup
  // Without a variant, production compiles no diagnostic stage and has no write mask of its own.
  const selected = blendVariantPipeline(variant)
  const { entryPoint, writeMask } = selected
  const constants = feedbackConstants(feedback)
  const label = `BLEND${variantLabel(key)}`
  const module = device.createShaderModule({ label, code: blendModuleCode(setup, key) })
  const sets = SHARE_TARGET_KEYS.map((withShare) => ({
    perMode: pipelinesByMode(device, (mode) =>
      stageDescriptors(
        device,
        module,
        layout,
        {
          module,
          entryPoint,
          constants,
          targets: blendTargets(mode, writeMask, feedback, false, withShare),
        },
        false,
        reflectedGroups(device),
      ),
    ),
    routed: createRoutedPipelines(device, module, layout, feedback, (mode) =>
      blendTargets(mode, writeMask, feedback, true, withShare),
    ),
  }))
  const { routed: maskSet } = sets[share]
  // The transmissive items' pipelines, on the same module (`./transmission/pipelines.ts`): their unlit
  // stages, the first program's of its lobe choice — the companion pass requests the lobes' maps.
  const lobes = +!!key.lobeless
  const transmission = transmissionCode?.createTransmitPipelines(
    device,
    module,
    layout,
    feedback,
    dualSource(device),
    setup.transmitted[lobes],
  )
  setup.transmitted[lobes] ??= transmission
  const dualPasses = transmission?.dual
    ? createDualPasses(device, module, layout, selected, feedback, transmission, (...a) =>
        pipelines.at(...a),
      )
    : undefined
  const blendsCatchUp = blendCatchUp(device, reach, sets, maskSet, !!variant)
  const catchUp = () =>
    Promise.all([
      blendsCatchUp(),
      transmission?.precompile(reach.state),
      dualPasses?.precompile(reach.state),
    ])
  reach.onChange(catchUp)
  await catchUp()
  const pipelines: BlendModePipelines = {
    mask: maskSet.mask,
    transmission,
    dualPasses,
    front: setup.front,
    reach: reach.reach,
    lit: (frame, lobed) => setup.programs().pick(frame, lobed).pipelines,
    lobedAwaited: () => setup.programs().awaited(FULL_CONTRACT),
    at(rank, filtered = false, withShare = 0) {
      // A transmissive rank: its fallback, or under a diagnostic variant the normal mode's.
      if (transmission && transmitsRank(rank))
        return transmission.over.at(rank, filtered, withShare)
      const mode = transmitsRank(rank) ? 'normal' : blendingOf(rank)
      if (!mode) throw new Error(`blend pipeline rank ${rank} names no blending mode`)
      const set = sets[withShare]
      return (filtered ? set.routed.filtered : set.perMode).at(mode, cullOf(rank))
    },
  }
  return { module, pipelines }
}

/**
 * The blend pass's two passes under the dual blend (`drawBlendPass`), on a program's `module`:
 * the colour pass on the HDR target alone — the blends in their modes with no other target and no
 * request computed, the transmissive layers dual (`colour`) —, and the companion pass that writes
 * what it leaves out, every layer's request and share (`companion`: the blends' `fsBlendCoverage`,
 * the transmissive layers' `fsTransmitCoverage` unless the distortion's accumulation wrote theirs);
 * with no transmissive item in view, the one pass on every target (`blends`). Each pipeline made at
 * its first use or by `precompile`.
 */
function createDualPasses(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  { entryPoint, writeMask }: { entryPoint: string; writeMask: GPUColorWriteFlags },
  feedback: boolean,
  transmission: TransmitPipelines,
  at: BlendModePipelines['at'],
) {
  const dual = transmission.dual!
  const colourSet = pipelinesByMode(device, (mode) =>
    stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint,
        constants: feedbackConstants(false),
        targets: blendTargets(mode, writeMask, false, false, 0).slice(0, 1),
      },
      false,
      reflectedGroups(device),
    ),
  )
  const covered: ReturnType<typeof preparedPipeline>[][] = []
  const coveredOf = (share: ShareTargets) =>
    (covered[share] ??= stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint: 'fsBlendCoverage',
        constants: feedbackConstants(feedback),
        targets: companionTargets(null, feedback, share),
      },
      false,
      reflectedGroups(device),
    ).map((descriptor) => preparedPipeline(device, descriptor)))
  const companions = [false, true].map((transmissive): RankedPipelines => ({
    at: (rank, _filtered, share = 0) =>
      transmitsRank(rank)
        ? transmission.coverage.at(rank, false, share)
        : coveredOf(share)[cullOf(rank)].get(),
    skips: transmissive ? undefined : transmitsRank,
  }))
  return {
    colour: {
      at: (rank: number) =>
        transmitsRank(rank) ? dual.at(rank) : colourSet.at(blendingOf(rank)!, cullOf(rank)),
    } satisfies RankedPipelines,
    companion: (transmissive: boolean) => companions[+transmissive],
    /** The one pass on every target of an image whose transmissive items are out of view: the
     *  program's own pipelines (\`at\`), the transmissive slots skipped. */
    blends: { at, skips: transmitsRank } satisfies RankedPipelines,
    /** What the scene reaches compiles off the frame: its modes' colour pipelines, the companion
     *  pass's of each share drawn. */
    precompile: ({ modes, shares }: Reach['state']) =>
      Promise.all([
        colourSet.precompile([...modes]),
        ...[...shares].flatMap((share) => coveredOf(share).map((pipeline) => pipeline.prepare())),
      ]),
  }
}

/** The blend pass's passes under the dual blend (`createDualPasses`). */
export type DualPasses = ReturnType<typeof createDualPasses>
