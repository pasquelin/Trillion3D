import { blendShader } from './shader.ts'
import type { BlendGpuItem } from './state.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import { blendLayoutEntries } from '../core/blendBindEntries.ts'
import {
  declaredBlendModes,
  pipelinesByMode,
  stageDescriptors,
  type BlendModePipelines,
  type ModePipelines,
} from './stagePipelines.ts'
import { BLEND_MODES } from '../../scene/materialBlending.ts'
import { createRoutedPipelines } from './routedPipelines.ts'
import { createReach, type Reach } from './reach.ts'
import { filtersDisplay } from './equations.ts'
import { prepareDisplayProgram } from './displayFilterProgram.ts'
import type { WaterPass } from '../water/waterPass.ts'
import { families } from '../../host/families.ts'
import {
  blendVariantPipeline,
  DIAGNOSTIC_BLEND_WGSL,
  type DiagnosticGpuVariant,
} from '../../diagnostic/gpuVariant.ts'
import { feedbackFreeEntry } from '../tile/feedbackAbWgsl.ts'
import { blendTargets } from './blendTargets.ts'
import { createForwardVariants, type ForwardLit } from '../../lighting/deferred/forwardVariants.ts'
import {
  FULL_CONTRACT,
  isTwin,
  variantLabel,
  type ContractKey,
} from '../../lighting/deferred/contractCuts.ts'

/** A blend program: its module, and the pipelines drawn with it. */
type BlendProgram = { module: GPUShaderModule; pipelines: BlendModePipelines }

/** The blend fragment's values, in their order: what a feedback-free entry keeps. */
const BLEND_OUT: [string, string][] = ['color', 'asIs', 'tint', 'add'].map((name) => [
  name,
  'vec4f',
])
const FRAGMENT_IN = ['in:VSOut,@builtin(front_facing) front:bool', 'in,front'] as const

/** The transmission code a scene that transmits imports (`families.transmission`). */
type WaterCode = Awaited<ReturnType<typeof families.transmission.load>>

/** What every blend program of a pass is compiled with. */
type BlendProgramSetup = {
  device: GPUDevice
  layout: GPUBindGroupLayout
  waterCode: WaterCode | undefined
  variant: DiagnosticGpuVariant | undefined
  feedback: boolean
  share: boolean
  reach: Reach
  /** The pass's lit programs, once made: what a frame's pick reads. */
  programs: () => ForwardVariants<BlendProgram>
}
type ForwardVariants<P> = Awaited<ReturnType<typeof createForwardVariants<P>>>
type RoutedPipelines = ReturnType<typeof createRoutedPipelines>

/** Builds the forward-material pipelines for transparent draws, and the water pass of a scene
 *  that transmits; a reference session's water walks its mirror ray whole (`unboundedReflections`,
 *  #1279): the session's `context`. Both light with the code the scene's lights need, as the opaque
 *  resolve (`createForwardVariants`): `lit` and `waterLit`, the keys their first frames ask for. */
export async function createWebgpuBlendPipelines(
  device: GPUDevice,
  items: BlendGpuItem[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
  share = false,
  {
    unboundedReflections,
    lit,
    waterLit,
  }: { unboundedReflections?: boolean; lit?: ForwardLit; waterLit?: ForwardLit } = {},
) {
  // The forward materials' layout, which the feedback-free diagnostic pipelines share: the
  // group's table (`blendLayoutEntries`), the view uniform at its size.
  const blendBindGroupLayout =
    sharedLayout ?? device.createBindGroupLayout({ entries: blendLayoutEntries(BLEND_VIEW_SIZE) })
  // The water pass exists for a scene that transmits, outside any diagnostic variant: under one,
  // the transmission slice draws as one more blend, the same fragment stage measured on all.
  const wantsWater = !variant && items.some((item) => item.transmissive)
  // Its code, transmission's, is imported by the first scene that transmits, glass or water, and
  // awaited here as the scene's other resources are, before any frame (#1353). An import that
  // could not load is the scene's refusal (`FAMILY_LOAD_FAILED`), never a scene without its water.
  const waterCode = wantsWater ? await families.transmission.load() : undefined
  // What the scene's materials and settings reach now (`reach.ts`): normal with any item (the
  // transmission slice draws on it under a diagnostic), every mode an item declares, the share set
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
    waterCode,
    variant,
    feedback,
    share,
    reach,
    programs: () => programs,
  }
  const programs = await createForwardVariants((key) => blendProgram(setup, key), lit)
  const unbounded = unboundedReflections === true
  const { water, waterRefused } = await blendWater(setup, programs, unbounded, waterLit)
  return { blendBindGroupLayout, blendPipelines: programs.twin.pipelines, water, waterRefused }
}

/** The water pass of a scene that transmits, on the twin's module. A device that refuses it keeps
 *  the blends, and `waterRefused` names why to the caller. */
async function blendWater(
  { device, layout, waterCode, feedback, reach }: BlendProgramSetup,
  programs: ForwardVariants<BlendProgram>,
  unbounded: boolean,
  waterLit: ForwardLit | undefined,
) {
  // The water's lobed stage is an entry of the lobed twin's module (`waterSurfaceWgsl`): the twin's
  // own when it has the lobes, else compiled once a transmissive surface brings one. It compiles
  // with the rest of the pass when one carries a lobe from the start (`waterLit`).
  const lobes = {
    module: async () => (await programs.ready(FULL_CONTRACT))?.module,
    now: waterLit?.key.lobeless === false,
  }
  let waterRefused: Error | undefined
  const water: WaterPass | undefined = await waterCode
    ?.createWaterPass(
      device,
      programs.twin.module,
      layout,
      feedback,
      unbounded,
      waterLit,
      reach,
      lobes,
    )
    .catch((error: unknown) => {
      waterRefused = error instanceof Error ? error : new Error(String(error))
      return undefined
    })
  return { water, waterRefused }
}

/** The blend module's text lit with the code `key` leaves in: the water surface stage, which lights
 *  nothing, is an entry of a twin's module alone — its lobed entry of the lobed one's. */
function blendModuleCode(setup: BlendProgramSetup, key: ContractKey) {
  const { waterCode, variant, feedback } = setup
  const surface = isTwin(key) ? waterCode : undefined
  let code = blendShader(key, {
    stage: surface?.waterSurfaceWgsl(!key.lobeless),
    diagnostic: variant ? DIAGNOSTIC_BLEND_WGSL : undefined,
  })
  if (!feedback) {
    for (const entry of ['fs', 'fsFiltered'])
      code = feedbackFreeEntry(code, entry, 'BlendOut', BLEND_OUT, ...FRAGMENT_IN)
    if (surface) code = surface.waterWithoutFeedback(code, !key.lobeless)
  }
  return code
}

/** The module lit with the code `key` leaves in, and its pipelines: two lazy sets (#365), with no
 *  reader of the share its slot stays empty, no target is bound. */
async function blendProgram(setup: BlendProgramSetup, key: ContractKey): Promise<BlendProgram> {
  const { device, layout, variant, feedback, share, reach } = setup
  // Without a variant, production compiles no diagnostic stage and has no write mask of its own.
  const selected = blendVariantPipeline(variant)
  const entryPoint = feedback ? selected.entryPoint : 'fsWithoutFeedback'
  const { writeMask } = selected
  const label = `BLEND${variantLabel(key)}`
  const module = device.createShaderModule({ label, code: blendModuleCode(setup, key) })
  const sets = [false, true].map((withShare) => ({
    perMode: pipelinesByMode(device, (mode) =>
      stageDescriptors(
        device,
        module,
        layout,
        { module, entryPoint, targets: blendTargets(mode, writeMask, feedback, false, withShare) },
        false,
      ),
    ),
    routed: createRoutedPipelines(device, module, layout, feedback, (mode) =>
      blendTargets(mode, writeMask, feedback, true, withShare),
    ),
  }))
  const { routed: maskSet } = sets[+share]
  const catchUp = blendCatchUp(device, reach, sets, maskSet, !!variant)
  reach.onChange(catchUp)
  await catchUp()
  const pipelines: BlendModePipelines = {
    mask: maskSet.mask,
    reach: reach.reach,
    lit: (frame, lobed) => setup.programs().pick(frame, lobed).pipelines,
    lobedAwaited: () => setup.programs().awaited(FULL_CONTRACT),
    at(rank, filtered = false, withShare = false) {
      const mode = BLEND_MODES[Math.floor(rank / 3)]
      if (!mode) throw new Error(`blend pipeline rank ${rank} names no blending mode`)
      const set = sets[+withShare]
      return (filtered ? set.routed.filtered : set.perMode).at(mode, rank % 3)
    },
  }
  return { module, pipelines }
}

/** Compiles, off the frame, what is reached and not made yet; a program built later, or a reach
 *  that grows, calls it again. The mask pass is one set's, whatever the share; the display layers
 *  are no part of a diagnostic variant (`beginDisplayFilter`). */
function blendCatchUp(
  device: GPUDevice,
  reach: Reach,
  sets: { perMode: ModePipelines; routed: RoutedPipelines }[],
  maskSet: RoutedPipelines,
  diagnostic: boolean,
) {
  return async () => {
    const { modes, shares } = reach.state
    const filtered = reach.state.filtered && !diagnostic
    const list = [...modes]
    await Promise.all([
      filtered && prepareDisplayProgram(device),
      ...[...shares].map((withShare) => {
        const { perMode, routed } = sets[+withShare]
        return Promise.all([
          perMode.precompile(list),
          filtered && (routed === maskSet ? routed : routed.filtered).precompile(list),
        ])
      }),
    ])
  }
}
