import { grantsVertexTextures } from '../gpu/core/vertexTextures.ts'
import { NO_RASTERS, type GraphRasters } from '../materials/graph/graphRasters.ts'
import type { WpoSet } from '../materials/graph/wpoProgram.ts'
import { blendWpo } from '../visibility/shader/wpoSets.ts'
import { TRANSLUCENT_RECT_LIGHTS_DEFAULT, blendShader, type TranslucentScene } from './shader.ts'
import type { VertexReads } from './cloudVertexText.ts'
import type { BlendGpuItem } from './state.ts'
import { contactShadowsOf, translucencyVolumeOf } from '../materials/surface/blendLightSource.ts'
import { BLEND_VIEW_SIZE } from './viewLayout.ts'
import { blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import {
  declaredBlendVariants,
  dualSource,
  cullPipelines,
  modePipelines,
  ofLayerKind,
  pipelinesByVariant,
  stageDescriptors,
  type BlendModePipelines,
  type TransmitPipelines,
} from './stagePipelines.ts'
import {
  blendingOf,
  chromaticSurface,
  cullOf,
  transmitsRank,
  variantBlending,
  variantOf,
  variantOfBlend,
  waterRank,
} from './plan/planCull.ts'
import { createRoutedPipelines } from './routedPipelines.ts'
import { track } from '../lighting/deferred/compileLedger.ts'
import { createReach, type Reach, type ReachedBy } from './reach.ts'
import { filtersDisplay } from './equations.ts'
import { blendCatchUp } from './blendCatchUp.ts'
import { families } from '../session/host/families.ts'
import { hasSubgroups } from '../gpu/core/subgroups.ts'
import type { Clipping } from '../gpu/core/clipDistances.ts'
import {
  blendVariantPipeline,
  DIAGNOSTIC_BLEND_WGSL,
  type DiagnosticGpuVariant,
} from '../diagnostic/gpuVariant.ts'
import { feedbackConstants } from '../materials/virtual/requestWgsl.ts'
import { blendTargets } from './blendTargets.ts'
import { RESPONSIVE_TARGET } from './responsive.ts'
import { HOLDOUT_TARGET } from './holdout.ts'
import { blendModeConstant } from '../materials/surface/materialBlending.ts'
import { createFrontStages, prepareFrontStage } from './frontStage.ts'
import { createRadianceMarkStage, prepareRadianceMarkStage } from './radianceMarkStage.ts'
import { createDualPasses } from './dualPasses.ts'
import { waterWgsl } from './water/waterStageWgsl.ts'
import { createWaterPipelines } from './water/waterPipelines.ts'
import { createForwardVariants, type ForwardLit } from '../lighting/deferred/forwardVariants.ts'
import { FULL_CONTRACT, variantLabel, type ContractKey } from '../lighting/deferred/contractCuts.ts'
import { graphProgramsOf } from './graphWgsl.ts'
import {
  TRANSLUCENT_SHADOW_DEFAULT,
  asksOfItsOwn,
  type TranslucentMaterialShadow,
  type TranslucentShadow,
} from '../lighting/direct/shadowWgsl.ts'

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
  responsive: boolean
  reach: Reach
  /** The pass's lit programs, once made: what a frame's pick reads. */
  programs: () => ForwardVariants<BlendProgram>
  /** The front stages every program draws its front pass with (`createFrontStages`). */
  front: ReturnType<typeof createFrontStages>
  /** The stage that marks the radiance cache's cells the transparents read (`createRadianceMarkStage`). */
  radianceMark: ReturnType<typeof createRadianceMarkStage>
  /** The first program's transmissive pipelines of each lobe choice, lobed then lobeless: what
   *  the others take their unlit stages from (`createTransmitPipelines`). */
  transmitted: (TransmitPipelines | undefined)[]
  /** How the programs' modules cut at a view's plane (`../gpu/core/clipDistances.ts`): none, they
   *  hold none of that code. */
  clipping?: Clipping
  /** Whether the programs hold the local fog volumes' code (the project switch
   *  `localFogVolumeSupport`): none, they hold none of it. */
  localFog: boolean
  /** What the programs' vertex stage reads (`VertexReads`): the clouds' shade and the cloud image
   *  (`cloudVertex.ts`) when the project switch `cloudShadowOnTranslucent` is on or the scene holds a
   *  surface whose material has `cloudFog` (`cloudFogOf`), and the fog of the surfaces whose fog is per vertex
   *  (`fogVertexOf`); of either not read, the programs hold none of that code, and the fragment works every fog out. */
  reads: VertexReads
  /** Whether the programs read the translucency lighting volume (`translucencyVolumeOf`): the scene
   *  holds a surface lit from it; none, they hold none of that code. */
  translucencyVolume: boolean
  /** How the programs' fragments read a light's shadow, the project switches
   *  `shadowTranslucentQuality` and `shadowTranslucentLocalLights` (`TranslucentShadow`), and what
   *  some surface of the scene asks of its own (`translucentShadowOf`), the water's included. */
  translucentShadow: TranslucentShadow
  /** What the scene decides of the programs' lights (`TranslucentScene`): whether they light a rectangle light as a rectangle, the
   *  project switch `translucentRectLights`, and whether they hold the contact shadows' code, for the surfaces whose material asks
   *  (`contactShadowsOf`). */
  scene: TranslucentScene
  /** Whether the scene holds a single-layer water: the programs hold its stage (`waterWgsl`). */
  water: boolean
  /** Whether the water pipelines write the separated sun (`BlendPipelineOptions.waterSeparate`). */
  waterSeparate: boolean
  /** The programs of the graphs the items wear (`graphProgramsOf`). */
  graphs: ReturnType<typeof graphProgramsOf>
  /** The offsets of those programs the session holds, which the vertex stages move vertices by. */
  offsets: WpoSet
}
type ForwardVariants<P> = Awaited<ReturnType<typeof createForwardVariants<P>>>

/** Whether a surface of `items` wears a material that receives the clouds in its fog (`cloudFog`):
 *  the programs then read the clouds per vertex. */
export const cloudFogOf = (items: readonly BlendedSurface[]) =>
  items.some((item) => item.surface.cloudFog === true)

/** Whether a surface of `items` takes its fog per vertex: its material takes any fog and works it out for the
 *  vertex (not `computeFogPerPixel`, not single-layer water, not opted out). The programs then lay the fog in the
 *  vertex stage; without such a surface they compile without its lanes (`cloudVertexText`). */
export const fogVertexOf = (items: readonly BlendedSurface[]) =>
  items.some(
    ({ surface }) => surface.fog !== false && !surface.computeFogPerPixel && surface.water !== true,
  )

/** What some surface of `items` asks of its own about the shadows its fragments read
 *  (`VisMaterial.translucentLocalLightShadow` and the two after it): the shadow code the programs
 *  hold beside the project's switches' (`TranslucentMaterialShadow`). */
export function translucentShadowOf(
  items: readonly BlendedSurface[],
  waterSunTrace = false,
): TranslucentMaterialShadow {
  const asked = { local: false, localTrace: false, directionalTrace: false }
  for (const { surface } of items) {
    asked.local ||= surface.translucentLocalLightShadow === true
    asked.localTrace ||= (surface.translucentLocalLightShadowQuality ?? 0) > 0
    asked.directionalTrace ||=
      (surface.translucentDirectionalLightShadowQuality ?? 0) > 0 ||
      (waterSunTrace && surface.water === true)
  }
  return asked
}

/** Whether programs built for the surfaces' asks `held` hold the code of those `needed`. */
export const coversTranslucentShadow = (
  held: TranslucentMaterialShadow | undefined,
  needed: TranslucentMaterialShadow,
) =>
  !asksOfItsOwn(needed) ||
  (!!held &&
    (held.local || !needed.local) &&
    (held.localTrace || !needed.localTrace) &&
    (held.directionalTrace || !needed.directionalTrace))

/** What the scene's materials and settings reach now (`reach.ts`): normal in the forward lighting with a transmissive item (it
 *  draws on it under a diagnostic), every variant an item declares (`declaredBlendVariants`), the responsiveness pass
 *  when it is drawn now, the distortion when an item refracts, the display layers when a mode filters. A change compiles its own, off the frame.
 *  No item, no blend program (#1362). */
export function reachedBy(
  items: readonly BlendedSurface[],
  responsive: boolean,
  variant: DiagnosticGpuVariant | undefined,
): ReachedBy {
  const declared = declaredBlendVariants(items)
  return {
    variants: declared,
    responsive,
    refracts: items.some((item) => item.surface.refracts),
    chromatic: items.some((item) => item.transmissive && chromaticSurface(item.surface)),
    filtered:
      !variant &&
      declared.some((declaredVariant) => filtersDisplay(variantBlending(declaredVariant)!)),
    holdout: declared.some(
      (declaredVariant) => variantBlending(declaredVariant) === 'alphaHoldout',
    ),
  }
}

const reachOf = (
  items: readonly BlendedSurface[],
  responsive: boolean,
  variant: DiagnosticGpuVariant | undefined,
) => createReach(reachedBy(items, responsive, variant))

/** What the pipelines of a pass are built with beside its items. */
export interface BlendPipelineOptions {
  /** The key the first frame's lighting asks for (`createForwardVariants`). */
  lit?: ForwardLit
  /** Whether the session holds transmission, whatever its items (`growth.ts`). */
  holdsTransmission?: boolean
  /** How the modules cut at a view's plane (`../gpu/core/clipDistances.ts`): none, they hold none
   *  of that code. */
  clipping?: Clipping
  /** Whether the programs read the clouds' shade per vertex (the project switch
   *  `cloudShadowOnTranslucent`, `cloudVertex.ts`): with it, the programs read the clouds per
   *  vertex whatever the scene; without, those of a scene that holds a `cloudFog` surface do. */
  cloudShade?: boolean
  /** How the programs' fragments read a light's shadow (the project switches
   *  `shadowTranslucentQuality` and `shadowTranslucentLocalLights`, read once when the session
   *  opens): the defaults, one sample of the sun's map, unless given. */
  translucentShadow?: TranslucentShadow
  /** Whether the programs light a rectangle light as a rectangle (the project switch
   *  `translucentRectLights`, read once when the session opens): as a point light unless given. */
  translucentRectLights?: boolean
  /** Whether the nearest translucent layer is lit by the sampled lighting (`lightsFrontLayer`): the programs read the light it left. */
  sampledFront?: boolean
  /** Whether the programs hold the local fog volumes' code (the project switch
   *  `localFogVolumeSupport`, on unless false). */
  localFog?: boolean
  /** The graph outputs the session holds (`WebgpuVisState.rasters`): the offsets its vertex stages
   *  move vertices by. */
  rasters?: GraphRasters
  /** Whether the settings trace the transparents' front layer (`reflectionFrontLayer`): the front stage compiled is the one
   *  that writes the reflecting surface, else the covering depth's alone. */
  frontLayer?: boolean
  /** Whether the water's settings trace the scene (`waterTraces`): the front stage is then compiled
   *  for the reflecting surface wherever the items hold a single-layer water. */
  waterReflects?: boolean
  /** Whether the programs hold the full trace of the sun's shadow for the water, which
   *  `singleLayerWaterVsmFiltering` marks it with (`singleLayerWaterShadersSupportVsmFiltering`, read when the
   *  session opens). */
  waterSunTrace?: boolean
  /** Whether the programs keep the water's sun apart from the rest of its light (the separated sun,
   *  `singleLayerWaterShadersSupportDistanceFieldShadow` or `…VsmFiltering`, read when the session opens). */
  waterSeparate?: boolean
  /** Whether the settings mark the radiance cache from the translucent surfaces (`screenProbeTranslucencyReflectionsRadianceCache`): the mark stage
   *  (`radianceMarkStage.ts`) is then compiled with the scene, else at the first frame that asks it. */
  radianceMark?: boolean
}

/** Builds the forward-material pipelines for transparent draws, the transmissive stages of a
 *  scene that transmits among them. They light with the code the scene's lights need, as the
 *  opaque resolve (`createForwardVariants`): `lit`, the key their first frame asks for. */
export async function createWebgpuBlendPipelines(
  device: GPUDevice,
  items: readonly BlendedSurface[],
  variant?: DiagnosticGpuVariant,
  feedback = true,
  sharedLayout?: GPUBindGroupLayout,
  responsive = false,
  options: BlendPipelineOptions = {},
) {
  const {
    lit,
    holdsTransmission,
    frontLayer = false,
    waterReflects = false,
    radianceMark = false,
  } = options
  // The forward materials' layout, which the feedback-free diagnostic pipelines share: the
  // group's table (`blendLayoutEntries`), the view uniform at its size.
  const blendBindGroupLayout =
    sharedLayout ??
    device.createBindGroupLayout({
      entries: blendLayoutEntries(BLEND_VIEW_SIZE, grantsVertexTextures(device)),
    })
  // The transmissive stages exist for a scene that transmits, outside any diagnostic variant:
  // under one, a transmissive item draws as one more blend, the same fragment stage measured on
  // all. A session that holds one (`holdsTransmission`) builds them whatever its items: one granted
  // for copies that have not joined yet (`growth.ts`).
  const transmits = !variant && (!!holdsTransmission || items.some((item) => item.transmissive))
  // Their code, transmission's, is imported by the first scene that transmits, and awaited here as
  // the scene's other resources are, before any frame (#1353). An import that could not load is
  // the scene's refusal (`FAMILY_LOAD_FAILED`), never a scene without its transmission.
  const transmissionCode = transmits ? await families.transmission.load() : undefined
  const setup = blendProgramSetup(
    {
      device,
      layout: blendBindGroupLayout,
      transmissionCode,
      variant,
      feedback,
      responsive,
      programs: () => programs,
    },
    items,
    options,
  )
  const programs = await createForwardVariants((key) => blendProgram(setup, key), lit)
  await prepareRadianceMarkStage(setup.radianceMark, items, radianceMark)
  await prepareFrontStage(
    setup.front,
    items,
    frontLayer || (waterReflects && items.some((item) => item.surface.water)),
  )
  return { blendBindGroupLayout, blendPipelines: programs.base.pipelines }
}

/** What a pass fixes before its items and options are read (`blendProgramSetup`). */
type BlendProgramBase = Pick<
  BlendProgramSetup,
  'device' | 'layout' | 'transmissionCode' | 'variant' | 'feedback' | 'responsive' | 'programs'
>

/** The setup every program of a pass is compiled with, from the pass's `base`, its `items` and
 *  its `options`. */
function blendProgramSetup(
  base: BlendProgramBase,
  items: readonly BlendedSurface[],
  options: BlendPipelineOptions,
): BlendProgramSetup {
  const {
    clipping,
    cloudShade = false,
    translucentShadow: projectShadow = TRANSLUCENT_SHADOW_DEFAULT,
    translucentRectLights = TRANSLUCENT_RECT_LIGHTS_DEFAULT,
    sampledFront = false,
    localFog = true,
    rasters = NO_RASTERS,
    waterSunTrace = false,
    waterSeparate = false,
  } = options
  const graphs = graphProgramsOf(items)
  const offsets = blendWpo(rasters, graphs)
  return {
    ...base,
    reach: reachOf(items, base.responsive, base.variant),
    graphs,
    water: items.some((item) => item.surface.water === true),
    waterSeparate,
    offsets,
    front: createFrontStages(base.device, base.layout, clipping, graphs, offsets),
    radianceMark: createRadianceMarkStage(base.device, clipping, graphs, offsets),
    transmitted: [],
    clipping,
    localFog,
    reads: { clouds: cloudShade || cloudFogOf(items), fog: fogVertexOf(items) },
    translucencyVolume: translucencyVolumeOf(items),
    translucentShadow: { ...projectShadow, materials: translucentShadowOf(items, waterSunTrace) },
    scene: { rectLights: translucentRectLights, contact: contactShadowsOf(items), sampledFront },
  }
}

/** The blend module's text lit with the code `key` leaves in, with the transmissive stages of a
 *  scene that transmits — the dual blend among them where the device grants it. */
function blendModuleCode(setup: BlendProgramSetup, key: ContractKey) {
  const { transmissionCode, variant, device } = setup
  const dual = !!transmissionCode && dualSource(device)
  const { scene } = setup
  const stage = transmissionCode?.transmitWgsl(
    key,
    dual,
    setup.graphs,
    setup.reads,
    asksOfItsOwn(setup.translucentShadow.materials!),
    scene,
  )
  return blendShader(key, {
    stage,
    diagnostic: variant ? DIAGNOSTIC_BLEND_WGSL : undefined,
    dual,
    subgroups: hasSubgroups(device),
    clipping: setup.clipping,
    graphs: setup.graphs,
    offsets: setup.offsets,
    reads: setup.reads,
    localFog: setup.localFog,
    translucentShadow: setup.translucentShadow,
    translucencyVolume: setup.translucencyVolume,
    scene,
    water: setup.water
      ? waterWgsl(
          key,
          setup.graphs,
          setup.reads,
          asksOfItsOwn(setup.translucentShadow.materials!),
          setup.translucentShadow.materials!.directionalTrace,
          scene,
        )
      : undefined,
  })
}

/** The blends' own pipelines on `module`: each variant's — a mode in a lighting program —, and the display-filtered (routed) ones. */
function blendModeSet(
  setup: BlendProgramSetup,
  module: GPUShaderModule,
  selected: ReturnType<typeof blendVariantPipeline>,
) {
  const { device, layout, feedback } = setup
  const { writeMask } = selected
  return {
    perVariant: modePipelines(device, module, layout, selected, feedback),
    routed: createRoutedPipelines(device, module, layout, feedback, (mode) =>
      blendTargets(mode, writeMask, feedback, true),
    ),
  }
}

/** The responsiveness pass of the blends: one target, no light, no feedback, the three culls. */
function responsivePipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
) {
  return cullPipelines(
    device,
    module,
    layout,
    {
      module,
      entryPoint: 'fsBlendResponsive',
      constants: feedbackConstants(false),
      targets: [RESPONSIVE_TARGET],
    },
    [],
  )
}

/** The alpha holdout's accumulation: one target, no light, no feedback, a mode's three culls compiled
 *  once the holdout is reached (`reach.ts`), the mode a constant of the pipeline; the variants it is asked by are the modes' in the forward lighting. */
function holdoutPipelines(device: GPUDevice, module: GPUShaderModule, layout: GPUBindGroupLayout) {
  return pipelinesByVariant(device, (variant) =>
    stageDescriptors(
      device,
      module,
      layout,
      {
        module,
        entryPoint: 'fsBlendHoldout',
        constants: { ...feedbackConstants(false), ...blendModeConstant(variantBlending(variant)!) },
        targets: [HOLDOUT_TARGET],
      },
      false,
      [],
    ),
  )
}

/** The transmissive items' pipelines, on the same module (`./transmission/pipelines.ts`): their
 *  unlit stages, the first program's of its lobe choice — the modulation pass's request stage reads the lobes'
 *  maps. */
function transmissionOf(setup: BlendProgramSetup, module: GPUShaderModule, key: ContractKey) {
  const { device, layout, feedback, transmissionCode } = setup
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
  return transmission
}

/** The responsiveness pipeline of a rank: the transmissive stages' where it transmits. */
const responsiveOf = (
  transmission: TransmitPipelines | undefined,
  blends: ReturnType<typeof responsivePipelines>,
): BlendModePipelines['responsive'] =>
  ofLayerKind(transmission && ((rank) => transmission.responsive.at(rank)), (rank) =>
    blends[cullOf(rank)].get(),
  )

/** The holdout pipeline of a rank: the transmissive stages' where it transmits. */
const holdoutOf = (
  transmission: TransmitPipelines | undefined,
  blends: ReturnType<typeof holdoutPipelines>,
): BlendModePipelines['holdout'] =>
  ofLayerKind(transmission && ((rank) => transmission.holdout.at(rank)), (rank) => {
    const mode = blendingOf(rank)
    return mode ? blends.at(variantOfBlend(mode, 'forward'), cullOf(rank)) : undefined
  })

/** The pipeline a plan rank is drawn with: its fallback under a diagnostic variant, the water's
 *  refused. */
const blendAtOf =
  (
    transmission: TransmitPipelines | undefined,
    set: ReturnType<typeof blendModeSet>,
  ): BlendModePipelines['at'] =>
  (rank, filtered = false) => {
    // A transmissive rank: its fallback, or under a diagnostic variant the normal mode's.
    if (waterRank(rank))
      throw new Error(`blend pipeline rank ${rank} is the water's: only its pass draws it`)
    if (transmission && transmitsRank(rank)) return transmission.over.at(rank, filtered)
    if (!transmitsRank(rank) && !blendingOf(rank))
      throw new Error(`blend pipeline rank ${rank} names no blending mode`)
    const variant = transmitsRank(rank) ? variantOfBlend('normal', 'forward') : variantOf(rank)
    return (filtered ? set.routed.filtered : set.perVariant).at(variant, cullOf(rank))
  }

/** The module lit with the code `key` leaves in, and its pipelines, each made at its first use or by
 *  `precompile`. */
async function blendProgram(setup: BlendProgramSetup, key: ContractKey): Promise<BlendProgram> {
  const { device, layout, variant, feedback, reach } = setup
  // Without a variant, production compiles no diagnostic stage and has no write mask of its own.
  const selected = blendVariantPipeline(variant)
  const label = `BLEND${variantLabel(key)}`
  const module = device.createShaderModule({ label, code: blendModuleCode(setup, key) })
  const set = blendModeSet(setup, module, selected)
  const responsiveBlends = responsivePipelines(device, module, layout)
  const holdoutBlends = holdoutPipelines(device, module, layout)
  const transmission = transmissionOf(setup, module, key)
  const dualPasses = transmission?.dual
    ? createDualPasses(device, module, layout, selected, feedback, transmission, (...a) =>
        pipelines.at(...a),
      )
    : undefined
  const water = setup.water
    ? createWaterPipelines(device, module, layout, feedback, setup.waterSeparate)
    : undefined
  const blendsCatchUp = blendCatchUp(device, reach, set, responsiveBlends, holdoutBlends, !!variant)
  const others = () => [
    transmission?.precompile(reach.state),
    dualPasses?.precompile(reach.state),
    water?.prepare(),
  ]
  // What the program is built with is awaited here; what the scene reaches later is asked, the
  // frames waiting for it.
  reach.onChange(() => {
    blendsCatchUp.ask()
    const compiling = Promise.all(others())
    track(device, compiling, true, 'blend mode programs')
    return compiling
  })
  await Promise.all([blendsCatchUp.prepare(), ...others()])
  const pipelines: BlendModePipelines = {
    mask: set.routed.mask,
    graphs: setup.graphs.map((program) => program.id),
    reads: setup.reads,
    scene: setup.scene,
    translucencyVolume: setup.translucencyVolume,
    translucentShadow: setup.translucentShadow.materials,
    transmission,
    dualPasses,
    water,
    front: setup.front,
    radianceMark: setup.radianceMark,
    reach: reach.reach,
    prepare: (next) => {
      // The scope a layer about to join widens this program's by, taken without telling the programs (the frames wait for none): everything it reaches is compiled here,
      // the routed modes, the display program, the holdout, the responsive, the transmission, the double passes and the water included.
      reach.reach(next, true)
      return Promise.all([blendsCatchUp.prepare(), ...others()]).finally(reach.announce)
    },
    lit: (frame, lobed) => setup.programs().pick(frame, lobed)?.pipelines,
    litAwaited: (frame, lobed) => setup.programs().awaited(frame, lobed),
    responsive: responsiveOf(transmission, responsiveBlends),
    holdout: holdoutOf(transmission, holdoutBlends),
    at: blendAtOf(transmission, set),
  }
  return { module, pipelines }
}

export type { DualPasses } from './dualPasses.ts'
