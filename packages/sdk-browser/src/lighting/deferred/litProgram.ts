import { reflectionCaptureBindEntries } from '../reflectionCapture/compositeWgsl.ts'
import { reflectionCaptureReadOf } from '../reflectionCapture/captureRead.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { cloudShadowBindEntries } from '../atmosphere/cloudShadowRead.ts'
import { cloudShadowStandIn } from '../atmosphere/cloudShadowStandIn.ts'
import { skyLightReadBindEntries } from '../../modules/sky/skyLight/read.ts'
import { skyLightStandIn } from '../../modules/sky/skyLight/standIn.ts'
import { lightProfileBindEntries } from '../lightProfile/profileBindings.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import {
  DEFERRED_BINDINGS,
  DEFERRED_CLOUD_SHADOW_BINDINGS,
  DEFERRED_LIGHT_PROFILE_BINDINGS,
  DEFERRED_CAPTURE_BINDINGS,
  DEFERRED_SKY_LIGHT_BINDINGS,
  TOON_DATA_BINDINGS,
} from './bindings.ts'
import type { ContractKey } from './contractCuts.ts'
import { indirectPassWgsl } from './indirectPassWgsl.ts'
import { INDIRECT_DIFFUSE_LIGHT_VIEW } from '../../visibility/shader/shadeMode.ts'
import {
  hairLayoutEntries,
  indirectLayoutEntries,
  localLayoutEntries,
  sunLayoutEntries,
  toonDataLayoutEntries,
} from './layoutEntries.ts'
import { localPassWgsl, sunPassWgsl } from './lightPassWgsl.ts'
import {
  buildRenderPipeline,
  pipelineLayoutOf,
  preparedPipeline,
  type PreparedPipeline,
} from './fullscreen.ts'
import { FURNACE_ENTRY, FURNACE_SAMPLES, FURNACE_SKY_ENTRY } from './furnaceWgsl.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { createPassGroup } from './passGroup.ts'
import type { ToonDataViews } from './toonData.ts'
import { PER_LIGHT_RECORD_BINDING_BYTES } from '../shadows/vsm/projection/perLightRecord.ts'
import type { DeferredBindings, DirectLightResources } from './program.ts'
import { drawTileClasses, lightPipelineDescriptor, moduleOfClass } from './tilePass.ts'
import { TILE_CLASS, TILE_CLASS_NAMES, TILE_CLASSES, type TileClass } from './tileClass.ts'
import { createPerLightProgram, type PerLightProgram } from './perLightProgram.ts'
import type { PerLightLights } from '../shadows/vsm/projection/perLightPass.ts'
import type { VsmHairMasks } from '../shadows/vsm/projection/hairProjectionPass.ts'

/** What a program is made from: whether it reads the probes (`bounce`), the key of the lights it
 *  lights (`ContractKey`: its list width, its cuts of shadow, rectangle and lobe code), whether it
 *  applies the sky light's distance-field occlusion (`skyShadowing`), and its name. */
export interface LitSources {
  bounce: boolean
  key: ContractKey
  skyShadowing: boolean
  /** Whether it applies the indirect capsule shadows (`capsuleIndirect`). */
  capsule: boolean
  label: string
}

/** The classes a program holds code for: those of the plain surfaces, and, where the key does not
 *  say the image wears no lobe, the lobed ones. A frame whose key is wrong lights its lobed tiles with
 *  the code of the class below. */
const classesOf = (key: ContractKey): readonly TileClass[] =>
  key.lobeless ? [TILE_CLASS.simple, TILE_CLASS.single] : TILE_CLASSES

/** One pass of a program: a pipeline for each class of tile (the classes it holds no code for use the
 *  highest it holds), and the modules those were made from, the highest class's last. */
async function passPipelines(
  device: GPUDevice,
  classes: readonly TileClass[],
  wgsl: (tileClass: TileClass) => WgslDecl,
  entry: string,
  layout: GPUBindGroupLayout,
  label: string,
  toon?: { writes: boolean },
) {
  const modules = await Promise.all(
    classes.map((tileClass) =>
      createCheckedShaderModule(
        device,
        wgslModule(wgsl(tileClass)),
        `${label}_${TILE_CLASS_NAMES[tileClass]}`,
      ),
    ),
  )
  const pipelines = await Promise.all(
    TILE_CLASSES.map((tileClass) =>
      buildRenderPipeline(
        device,
        lightPipelineDescriptor(device, modules, layout, entry, label, tileClass, toon),
      ),
    ),
  )
  return { modules, pipelines }
}

/**
 * A lit program: the passes that add the direct and the indirect light to the lit image, over the
 * tiles of the surfaces (`tileClass.ts`) — the sun's pass, the local lights', the indirect light's —,
 * compiled together for the key of the lights they light (`ContractKey`), whether the probes bounce
 * light (`bounce`) and whether the sky light is under the distance fields' occlusion
 * (`skyShadowing`). It keeps the bind groups of each pass while its resources do not change.
 *
 * A view of the lit image that shows one lighting term (`LIT_VIEWS`) draws the passes that give it:
 * the reflection or the bounced light alone, the indirect pass; the shadows, a pass of its own, its
 * pipelines made at the first image that asks.
 */
export async function createLitProgram(
  device: GPUDevice,
  sources: LitSources,
  bindings: DeferredBindings,
) {
  const { bounce, key, skyShadowing, capsule, label } = sources
  const lobes = !key.lobeless,
    profiled = !key.profileless,
    cubed = !key.cubeless,
    captured = !key.captureless,
    contact = !key.contactless,
    sampled = !!key.sampled,
    volume = !!key.volumeShadow,
    closures = bounce && !!key.closures
  const layouts = litLayouts(device, {
    bounce,
    skyShadowing,
    capsule,
    lobes,
    profiled,
    cubed,
    captured,
    contact,
    sampled,
    volume,
    closures,
  })
  const passes = await litPasses(device, sources, layouts)
  const perLight = createPerLightProgram(device, {
    key,
    classes: classesOf(key),
    lobes,
    profiled,
    contact,
    volume,
    label,
    localLayout: layouts.local,
  })
  const toonDataLayout = key.toonData
    ? device.createBindGroupLayout({ entries: toonDataLayoutEntries() })
    : undefined
  const p: LitState = {
    device,
    uniform: bindings.uniform,
    placeholders: bindings.placeholders,
    bounce,
    skyShadowing,
    capsule,
    lobes,
    profiled,
    cubed,
    captured,
    contact,
    sampled,
    volume,
    closures,
    label,
    toon: !!key.toonData,
    toonDataLayout,
    toonGroup: createPassGroup(device, () => toonDataLayout!),
    key,
    layouts,
    ...passes,
    perLight,
    groups: litGroups(device, layouts, perLight),
    // What the groups name, in a fixed order, so that a frame whose resources did not move allocates
    // nothing (`createPassGroup`).
    named: { sun: [], local: [], indirect: [], perLight: [], oneLight: [], hair: [] },
  }
  // A program that writes the toon data is lent only once the pipelines of the toon diffuse pass are compiled (`toonReady`): they start now, no frame waiting (a twin or the bounce pair
  // may never be lent); the frames wait for them (`askToon`) only when the variant table is about to lend this program (`litResolver`, `contractVariants.ts`). A refused compile
  // (`toonRefused`), for good or to be tried again by the pipeline's own policy, has the variant table lend the plain programs meanwhile.
  if (p.toon) for (const pipeline of toonPipelines(p)) pipeline?.start()

  return {
    /** Whether it reads the probes' light. */
    bounce,
    /** Whether it writes the toon data: the lit image's pass has the toon targets (`ContractKey.toonData`). */
    toon: p.toon,
    /** Whether the pipelines of the toon diffuse pass are compiled (true for a program that writes no toon data): the lights it draws are not followed by a step that is missing. */
    get toonReady() {
      return !p.toon || toonPipelines(p).every((pipeline) => !pipeline || pipeline.ready)
    },
    /** Whether the device refused a pipeline of the toon diffuse pass and it has not landed since: this program is not lent as a toon one meanwhile. */
    get toonRefused() {
      return p.toon && toonPipelines(p).some((pipeline) => pipeline?.refused)
    },
    /** Settles once each pipeline of the toon diffuse pass that is not refused has landed or been refused, no frame waiting for it. A pipeline already refused is not waited for: its retry, when it lands, is heard by the device (`onRetryLanded`), the one path of a retry. */
    toonLanded: () =>
      Promise.allSettled(
        toonPipelines(p).map((pipeline) => (pipeline?.refused ? undefined : pipeline?.prepare())),
      ),
    /** The frames wait for the pipelines of the toon diffuse pass, not yet compiled nor refused: the program a frame is about to be lent. */
    askToon() {
      if (p.toon) for (const pipeline of toonPipelines(p)) pipeline?.ask()
    },
    ...litCalls(p),
  }
}

/** The layouts of the four passes' group 0, over the variant's features. */
function litLayouts(
  device: GPUDevice,
  f: {
    bounce: boolean
    skyShadowing: boolean
    capsule: boolean
    lobes: boolean
    profiled: boolean
    cubed: boolean
    captured: boolean
    contact: boolean
    sampled: boolean
    volume: boolean
    /** The bounce program reads the screen probes' history of every closure a pixel holds. */
    closures: boolean
  },
) {
  const {
    bounce,
    skyShadowing,
    capsule,
    lobes,
    profiled,
    cubed,
    captured,
    contact,
    sampled,
    volume,
    closures,
  } = f
  return {
    sun: device.createBindGroupLayout({ entries: sunLayoutEntries(lobes, contact, volume) }),
    local: device.createBindGroupLayout({
      entries: localLayoutEntries(lobes, profiled, contact, sampled, volume),
    }),
    indirect: device.createBindGroupLayout({
      entries: indirectLayoutEntries({
        bounce,
        skyShadowing,
        lobes,
        cubed,
        capsule,
        captured,
        closures,
      }),
    }),
    hair: device.createBindGroupLayout({
      entries: hairLayoutEntries(lobes, profiled, contact, sampled, volume),
    }),
  }
}

/** The pass groups of the passes, over their layouts. */
function litGroups(
  device: GPUDevice,
  layouts: ReturnType<typeof litLayouts>,
  perLight: Pick<PerLightProgram, 'layout' | 'oneLayout'>,
) {
  return {
    sun: createPassGroup(device, layouts.sun),
    local: createPassGroup(device, layouts.local),
    hair: createPassGroup(device, layouts.hair),
    indirect: createPassGroup(device, layouts.indirect),
    perLight: createPassGroup(device, () => perLight.layout),
    oneLight: createPassGroup(device, () => perLight.oneLayout),
  }
}

/** A program of the lights' passes. */
export type LitProgram = Awaited<ReturnType<typeof createLitProgram>>

/** The calls of a lit program over its state. */
function litCalls(p: LitState) {
  return {
    /** Names the frame's resources, an absent one by its stand-in, and makes a pass's group again
     *  only when one of its resources was replaced. `tileList` is the classification's lists
     *  (`createTileClassification`'s `lists`). */
    bind(
      surface: SurfaceBuffer,
      depth: GPUTextureView,
      direct: DirectLightResources,
      tileList: GPUBuffer,
    ) {
      p.held = bindLitGroups(p, surface, depth, direct, tileList)
    },
    /**
     * Records one step of the lit image (`LightStep`, in the order `litSteps` lists them) into `pass`, the lit image's render pass
     * with its viewport set and the surfaces' colour already drawn (`createSurfaceColourPass`), over the tiles `draws` lists
     * (`createTileClassification`'s `draws`). One pass holds as many steps as the order allows: a tiled GPU loads the image into
     * its tile memory and stores it once, and the additive blends are the same sums in the same order. With `perLight`, the
     * path of `shadowOnePassProjection` or `clusteredDeferredShading` false is taken: the local lights' step leaves out the shadowed lights, and the steps
     * `litSteps` lists for them, a light each, draw them (`PerLightProgram.drawLight`). Returns the draws made.
     */
    drawStep(
      pass: GPURenderPassEncoder,
      draws: GPUBuffer,
      step: LightStep,
      perLight?: PerLightLights,
      toonData?: ToonDataViews,
    ) {
      return drawLit(p, pass, draws, step, perLight, toonData)
    },
    /** What the pass that lights the strands' samples is made over (`../../hair/hairLightPass.ts`): the layouts of its group 0 —
     *  the local lights' with the clouds' shade for the lights, the indirect pass's for the sky light —, and what its
     *  program is made from. Its groups follow the last `bind` (`hairGroup`, `hairSkyGroup`). */
    hair: {
      layout: p.layouts.hair,
      skyLayout: p.layouts.indirect,
      key: p.key,
      cubed: p.cubed,
      label: p.label,
    },
    hairGroup: (masks: HairMasks) => p.held?.hair(masks),
    hairSkyGroup: () => p.held?.indirect,
    /** Whether the pipelines of the per-light path are compiled (`createPerLightProgram`), those of the draws that read the packed mask where `packed`;
     *  the frames wait for them otherwise. */
    perLightReady: (packed: boolean) => p.perLight.ready(packed),
    /**
     * Records the shading furnace test (`furnaceWgsl.ts`) into `pass`, a pass over the lit image as it stands: the surfaces' pixels
     * replaced over the tiles `draws` lists, the others over one triangle, `samples` samples of each set. Its pipelines are made at the
     * first image that asks; none is drawn while they compile. Returns the draws made.
     */
    drawFurnace(pass: GPURenderPassEncoder, draws: GPUBuffer, samples: number) {
      return drawFurnace(p, pass, draws, samples)
    },
    release() {
      for (const group of Object.values(p.groups)) group.release()
      p.toonGroup.release()
      p.held = undefined
    },
  }
}

type LitLayouts = Record<'sun' | 'local' | 'indirect' | 'hair', GPUBindGroupLayout>

/** The pipelines of the three passes, made together. */
async function litPasses(device: GPUDevice, sources: LitSources, layouts: LitLayouts) {
  const { bounce, key, skyShadowing, capsule, label } = sources
  const classes = classesOf(key)
  // A program that writes the toon data names its targets in every pass of the lit image; the light passes write them, the indirect light's does not.
  const toon = key.toonData ? { writes: true } : undefined
  const [sun, local, indirect] = await Promise.all([
    passPipelines(
      device,
      classes,
      (c) => sunPassWgsl(key, c),
      'sunMain',
      layouts.sun,
      `${label}_SUN`,
      toon,
    ),
    passPipelines(
      device,
      classes,
      (c) => localPassWgsl(key, c),
      'localMain',
      layouts.local,
      `${label}_LOCAL`,
      toon,
    ),
    passPipelines(
      device,
      classes,
      (c) =>
        indirectPassWgsl({
          bounce,
          skyShadowing,
          cubed: !key.cubeless,
          captured: !key.captureless,
          capsule,
          closures: !!key.closures,
          tileClass: c,
        }),
      'indirectMain',
      layouts.indirect,
      `${label}_INDIRECT`,
      key.toonData ? { writes: false } : undefined,
    ),
  ])
  return { sun, local, indirect }
}

/** The masks of the shadows on the strands' pixels (`VsmHairMasks`): none where the frame holds no light of the kind. */
type HairMasks = Pick<VsmHairMasks, 'suns' | 'locals'>

/** The groups of the last `bind`. */
interface HeldGroups {
  sun: GPUBindGroup
  local: GPUBindGroup
  indirect: GPUBindGroup
  /** The per-light draw's group, where the frame lights the shadowed local lights one by one (`DirectLightResources.perLight`): the draw's own, or
   *  the one-light local pass's where the lights read the packed mask. */
  perLight?: GPUBindGroup
  /** The local lights' group with the strands' masks in place of the surfaces' (`hairGroup`). */
  hair(masks: HairMasks): GPUBindGroup
  /** Whether the scene has a light of the kind each of the first two passes walks. */
  suns: boolean
  locals: boolean
}

/** What a lit program holds between calls. */
interface LitState {
  readonly device: GPUDevice
  readonly uniform: GPUBuffer
  readonly placeholders: DeferredBindings['placeholders']
  readonly bounce: boolean
  readonly skyShadowing: boolean
  readonly capsule: boolean
  readonly lobes: boolean
  /** Whether the program reads the light profiles: it binds their atlas (`ContractKey.profileless`). */
  readonly profiled: boolean
  /** Whether the program reads the ambient cubemap: it binds the cube (`ContractKey.cubeless`). */
  readonly cubed: boolean
  /** Whether the program reads the reflection captures: it binds their cube array and records (`ContractKey.captureless`). */
  readonly captured: boolean
  /** Whether the passes of lights hold contact shadow code (`ContractKey.contactless`): they bind the screen-space shadows' array and its layers' ranks. */
  readonly contact: boolean
  /** Whether the local lights' pass adds the light the sampled lighting left (`ContractKey.sampled`): it binds that light's texture. */
  readonly sampled: boolean
  /** Whether the passes of lights read the volumes' shadows (`ContractKey.volumeShadow`): they bind the packed buffer. */
  readonly volume: boolean
  /** Whether the bounce program reads the screen probes' history of every closure a pixel holds (`ContractKey.closures`): it binds the two arrays. */
  readonly closures: boolean
  readonly label: string
  /** Whether the program writes the toon data (`ContractKey.toonData`): its passes name the toon targets, and the step after the lights applies the toon diffuse. */
  readonly toon: boolean
  /** The key of the lights the program lights. */
  readonly key: ContractKey
  readonly layouts: LitLayouts
  readonly sun: Awaited<ReturnType<typeof passPipelines>>
  readonly local: Awaited<ReturnType<typeof passPipelines>>
  readonly indirect: Awaited<ReturnType<typeof passPipelines>>
  readonly groups: Record<
    'sun' | 'local' | 'indirect' | 'perLight' | 'oneLight' | 'hair',
    ReturnType<typeof createPassGroup>
  >
  readonly named: Record<'sun' | 'local' | 'indirect' | 'perLight' | 'oneLight' | 'hair', unknown[]>
  /** The per-light passes, whose pipelines are made at the first frame that takes the path. */
  readonly perLight: PerLightProgram
  held?: HeldGroups
  /** The pipelines of the shadows' view, made at the first image that shows it, from the module of
   *  the class that holds its code (`localPassWgsl`). */
  visibility?: PreparedPipeline<GPURenderPipeline>[]
  /** The pipelines of the toon pixels' diffuse, applied once to the sum of the lights from the toon data (`toonMain`), for the tiles of the classes that hold toon pixels. */
  toonApply?: (PreparedPipeline<GPURenderPipeline> | undefined)[]
  /** The layout of the toon data's group, where the program writes it. */
  readonly toonDataLayout?: GPUBindGroupLayout
  readonly toonGroup: ReturnType<typeof createPassGroup>
  /** The pipelines of the indirect pass's view of the indirect diffuse light alone, made at the first image that shows it. */
  diffuseView?: PreparedPipeline<GPURenderPipeline>[]
  /** The pipelines of the shading furnace test, made at the first image that runs it, for the samples it asks. */
  furnace?: {
    readonly samples: number
    readonly modules: GPUShaderModule[]
    readonly tiles: PreparedPipeline<GPURenderPipeline>[]
    readonly sky: PreparedPipeline<GPURenderPipeline>
  }
}

/** The pipelines of the toon diffuse pass (`toonMain`, the program of the shadows' view), in a pass of its own that reads the toon data: for the tiles of every class that holds a model, none for the plain ones. */
function toonPipelines(p: LitState) {
  return (p.toonApply ??= TILE_CLASSES.map((tileClass) =>
    tileClass === TILE_CLASS.simple
      ? undefined
      : preparedPipeline(
          p.device,
          lightPipelineDescriptor(
            p.device,
            [moduleOfClass(p.local.modules, TILE_CLASS.single)],
            [p.layouts.local, p.toonDataLayout!],
            'toonMain',
            `${p.label}_LOCAL_TOON`,
            tileClass,
          ),
        ),
  ))
}

/**
 * A variant of the lit program run apart (`name`, the tail of its labels): its modules, one for each class the program holds (`code` the text of a class; those in `held` when the variant
 * made them already), and its pipelines, one for each tile class, over `layout` at `entry` (`finish` shapes the descriptor of a class where the variant differs from the program's).
 */
function variantPipelines(
  p: LitState,
  v: {
    name: string
    code: (tileClass: TileClass) => WgslDecl
    layout: GPUBindGroupLayout | readonly GPUBindGroupLayout[]
    entry: string
    held?: GPUShaderModule[]
    toon?: { writes: boolean }
    finish?: (descriptor: GPURenderPipelineDescriptor) => GPURenderPipelineDescriptor
  },
) {
  const { device, label, key } = p
  const modules =
    v.held ??
    classesOf(key).map((tileClass) =>
      device.createShaderModule({
        label: `${label}_${v.name}_${TILE_CLASS_NAMES[tileClass]}`,
        code: wgslModule(v.code(tileClass)),
      }),
    )
  const tiles = TILE_CLASSES.map((tileClass) => {
    const descriptor = lightPipelineDescriptor(
      device,
      modules,
      v.layout,
      v.entry,
      `${label}_${v.name}`,
      tileClass,
      v.toon,
    )
    return preparedPipeline(device, v.finish ? v.finish(descriptor) : descriptor)
  })
  return { modules, tiles }
}

/** The pipelines of the indirect pass's variant of the indirect diffuse light alone (`indirectPassWgsl`'s `diffuseView`), over the indirect pass's bindings: its text
 *  exists in no other program. */
function diffuseViewPipelines(p: LitState) {
  return (p.diffuseView ??= variantPipelines(p, {
    name: 'INDIRECT_DIFFUSE',
    code: (tileClass) =>
      indirectPassWgsl({
        bounce: p.bounce,
        skyShadowing: p.skyShadowing,
        cubed: !p.key.cubeless,
        captured: !p.key.captureless,
        capsule: p.capsule,
        closures: !!p.key.closures,
        diffuseView: true,
        tileClass,
      }),
    layout: p.layouts.indirect,
    entry: 'indirectMain',
    toon: p.key.toonData ? { writes: false } : undefined,
  }).tiles)
}

function visibilityPipelines(p: LitState) {
  return (p.visibility ??= TILE_CLASSES.map((tileClass) =>
    preparedPipeline(
      p.device,
      lightPipelineDescriptor(
        p.device,
        [moduleOfClass(p.local.modules, TILE_CLASS.single)],
        p.layouts.local,
        'visibilityMain',
        `${p.label}_LOCAL_VISIBILITY`,
        tileClass,
        p.toon ? { writes: false } : undefined,
      ),
    ),
  ))
}

/** The pipelines of the shading furnace test for `samples`, from the sun's bindings: its program over the classes the program holds, the surfaces'
 *  pixels written over the tiles (no blend: the lit image is replaced), the others over one triangle. */
function furnacePipelines(p: LitState, samples: number) {
  if (p.furnace?.samples === samples) return p.furnace
  const { device, label, layouts } = p
  const targets: GPUColorTargetState[] = [{ format: HDR_FORMAT }]
  // The modules and the sky pipeline do not hold the samples (`FURNACE_SAMPLES` is an override of the tiles' pipelines): made once.
  const { modules, tiles } = variantPipelines(p, {
    name: 'FURNACE',
    code: (tileClass) => sunPassWgsl(p.key, tileClass, true),
    layout: layouts.sun,
    entry: FURNACE_ENTRY,
    held: p.furnace?.modules,
    finish: (descriptor) => ({
      ...descriptor,
      fragment: { ...descriptor.fragment!, targets, constants: { [FURNACE_SAMPLES]: samples } },
    }),
  })
  let sky = p.furnace?.sky
  if (!sky) {
    const module = moduleOfClass(modules, TILE_CLASS.complex)
    sky = preparedPipeline(device, {
      label: `${label}_FURNACE_SKY`,
      layout: pipelineLayoutOf(device, [layouts.sun]),
      vertex: { module, entryPoint: 'furnaceCorner' },
      fragment: { module, entryPoint: FURNACE_SKY_ENTRY, targets },
      primitive: { topology: 'triangle-list' },
    })
  }
  return (p.furnace = { samples, modules, tiles, sky })
}

function drawFurnace(p: LitState, pass: GPURenderPassEncoder, draws: GPUBuffer, samples: number) {
  const { held } = p
  if (!held) throw new Error('SURFACE_NOT_BOUND')
  const { tiles, sky } = furnacePipelines(p, samples)
  pass.setBindGroup(0, held.sun)
  let made = drawTileClasses(
    pass,
    tiles.map((pipeline) => pipeline.get()),
    draws,
  )
  const background = sky.get()
  if (background) {
    pass.setPipeline(background)
    pass.draw(3)
    made++
  }
  return made
}

/** The frame's resources, an absent one replaced by its stand-in. */
function resolveDirect(
  device: GPUDevice,
  placeholders: DeferredBindings['placeholders'],
  direct: DirectLightResources,
) {
  return {
    ...resolveLightInputs(placeholders, direct),
    ...resolveIndirectInputs(device, placeholders, direct),
  }
}

/** The direct lights' inputs of the frame, an absent one by its stand-in. */
function resolveLightInputs(
  placeholders: DeferredBindings['placeholders'],
  direct: DirectLightResources,
) {
  return {
    tiles: direct.tiles ?? placeholders.tiles,
    sunRanks: direct.sunRanks ?? placeholders.sunRanks,
    mask: direct.vsmMask ?? placeholders.vsmMask,
    lightGrid: direct.vsmLightGrid ?? placeholders.vsmLightGrid,
    sunMask: direct.vsmSunMask ?? placeholders.vsmSunMask,
    lightFunction: direct.lightFunction ?? placeholders.lightFunction,
    lightProfile: direct.lightProfile ?? placeholders.lightProfile,
    contactBend: direct.contactBend ?? placeholders.contactBend,
    sampledLight: direct.sampledLight ?? placeholders.volumetricLight,
    volumeShadowMaps: direct.volumeShadowMaps ?? placeholders.volumeShadowMaps,
    toonTables: direct.toonTables ?? placeholders.toonTables,
  }
}

/** The ambient and indirect inputs of the frame, an absent one by its stand-in. */
function resolveIndirectInputs(
  device: GPUDevice,
  placeholders: DeferredBindings['placeholders'],
  direct: DirectLightResources,
) {
  return {
    cube: direct.ambientCubemap ?? placeholders.ambientCubemap,
    cloudShadow: direct.cloudShadow ?? cloudShadowStandIn(device),
    sky: direct.sky ?? skyLightStandIn(device),
    reflection: direct.reflection ?? placeholders.reflection,
    occlusion: direct.ambientOcclusion ?? placeholders.ambientOcclusion,
    lightmapLight: direct.volumetricLight ?? placeholders.volumetricLight,
    screen: direct.screenIndirect ?? placeholders.screenIndirect,
    screenGi: direct.screenShortRangeGi ?? placeholders.screenShortRangeGi,
    screenClosures: direct.screenIndirectClosures ?? placeholders.screenIndirectClosures,
    screenGiClosures: direct.screenShortRangeGiClosures ?? placeholders.screenShortRangeGiClosures,
    shadowing: direct.skyShadowing ?? placeholders.skyShadowing,
    capsuleIndirect: direct.capsuleIndirect ?? placeholders.capsuleIndirect,
  }
}

type Resolved = ReturnType<typeof resolveDirect>

/** The shadow maps' buffers of the frame, an absent one by its stand-in. */
function vsmFallback(maps: DirectLightResources['vsm'], placeholders: LitState['placeholders']) {
  return {
    vsmUniforms: { buffer: maps?.uniforms ?? placeholders.vsmUniforms },
    vsmPageTable: { buffer: maps?.pageTable ?? placeholders.vsmPageTable },
    vsmProjectionData: { buffer: maps?.projectionData ?? placeholders.vsmProjectionData },
    vsmPool: { buffer: maps?.pool ?? placeholders.vsmPool },
    vsmView: { buffer: maps?.view ?? placeholders.vsmProjectionView },
  }
}

type Fallback = ReturnType<typeof vsmFallback>

/** What the groups of the three passes share. */
interface SharedBindings {
  readonly pixel: Record<string, unknown>
  readonly shadows: { vsmSunMask: GPUTextureView; lightFunctionAtlas: GPUTextureView }
}

/** Fills what the three groups name, in their fixed order. */
function nameResources(
  p: LitState,
  surface: SurfaceBuffer,
  depth: GPUTextureView,
  direct: DirectLightResources,
  lights: GPUBuffer,
  tileList: GPUBuffer,
  r: Resolved,
  fallback: Fallback,
) {
  const { sun: sunNamed, local: localNamed, indirect: indirectNamed } = p.named
  const { cloudShadow, sky, shadowing } = r
  sunNamed.length = 0
  sunNamed.push(surface, depth, lights, tileList, r.sunRanks, r.sunMask, r.toonTables)
  sunNamed.push(r.lightFunction, cloudShadow.block, cloudShadow.maps[0], cloudShadow.maps[1])
  sunNamed.push(cloudShadow.sampler, r.occlusion)
  if (p.contact) sunNamed.push(r.contactBend.view, r.contactBend.ranks)
  if (p.volume) sunNamed.push(r.volumeShadowMaps)
  localNamed.length = 0
  localNamed.push(surface, depth, lights, tileList, r.tiles, r.mask, r.sunMask, r.toonTables)
  localNamed.push(r.lightFunction, r.lightGrid, r.occlusion)
  // The atlas's view changes only when its texture is made: the group follows it.
  if (p.profiled) localNamed.push(r.lightProfile.view, r.lightProfile.rectView)
  if (p.contact) localNamed.push(r.contactBend.view, r.contactBend.ranks)
  if (p.sampled) localNamed.push(r.sampledLight)
  if (p.volume) localNamed.push(r.volumeShadowMaps)
  localNamed.push(
    fallback.vsmUniforms.buffer,
    fallback.vsmPageTable.buffer,
    fallback.vsmProjectionData.buffer,
    fallback.vsmPool.buffer,
    fallback.vsmView.buffer,
  )
  indirectNamed.length = 0
  indirectNamed.push(surface, depth, lights, tileList, r.occlusion, r.reflection, sky.cube)
  indirectNamed.push(r.toonTables)
  indirectNamed.push(r.lightmapLight)
  indirectNamed.push(sky.sampler, sky.harmonics, sky.params)
  if (p.bounce) indirectNamed.push(r.screen)
  if (p.closures) indirectNamed.push(r.screenClosures, r.screenGiClosures)
  if (p.skyShadowing) indirectNamed.push(shadowing.bent, shadowing.params)
  if (p.capsule) indirectNamed.push(r.capsuleIndirect)
  if (p.cubed) indirectNamed.push(r.cube.view, r.cube.colour)
  if (p.captured) {
    const set = reflectionCaptureReadOf(p.device)
    indirectNamed.push(set.cube, set.block)
  }
}

/** The three groups of a frame, made again only when a resource of one was replaced. */
function bindLitGroups(
  p: LitState,
  surface: SurfaceBuffer,
  depth: GPUTextureView,
  direct: DirectLightResources,
  tileList: GPUBuffer,
): HeldGroups {
  const lights = direct.lights
  if (!lights) throw new Error('the contract program binds no declared-light buffer')
  const { bounce, groups, named } = p
  const r = resolveDirect(p.device, p.placeholders, direct)
  if (bounce && !direct.bounceGrid) throw new Error('the bounce program binds no probe grid')
  const [colours, words] = surface.stores()
  const shared: SharedBindings = {
    pixel: {
      colours,
      emissiveAo: surface.views()[2],
      words,
      depth,
      view: { buffer: p.uniform },
      tileList: { buffer: tileList },
      lights: { buffer: lights },
      subsurface: surface.subsurfaceView,
      ...(p.lobes && { lobes: surface.lobesView }),
    },
    shadows: { vsmSunMask: r.sunMask, lightFunctionAtlas: r.lightFunction },
  }
  const fallback = vsmFallback(direct.vsm, p.placeholders)
  nameResources(p, surface, depth, direct, lights, tileList, r, fallback)
  return {
    sun: groups.sun.get(named.sun, () => sunEntries(p, shared, r)),
    local: groups.local.get(named.local, () => localEntries(p, shared, r, fallback)),
    indirect: groups.indirect.get(named.indirect, () => indirectEntries(p, shared, r)),
    hair: (masks) => hairGroup(p, shared, r, fallback, masks),
    perLight:
      direct.perLight &&
      (direct.perLight.mask
        ? perLightGroup(p, shared, r, lights, tileList, direct.perLight, direct.perLight.mask)
        : oneLightGroup(p, shared, r, fallback, direct.perLight)),
    // The suns the sampled lighting lights are left out of the sun's pass; the local lights' pass adds the sampled light even where the scene has no local light.
    suns: direct.suns !== 0 && !direct.sampledSun,
    locals: direct.locals !== 0 || !!direct.sampled,
  }
}

/** The group of the pass that lights the strands' samples: the local lights' resources with the strands' masks at the ranks
 *  of the surfaces' (the sun's mask and the local lights' mask the shadows are read at), and the clouds' shade. */
function hairGroup(
  p: LitState,
  shared: SharedBindings,
  r: Resolved,
  fallback: Fallback,
  masks: HairMasks,
) {
  const suns = masks.suns ?? r.sunMask,
    locals = masks.locals ?? r.mask
  const named = p.named.hair
  named.length = 0
  named.push(...p.named.local, suns, locals)
  const { cloudShadow } = r
  named.push(cloudShadow.block, cloudShadow.maps[0], cloudShadow.maps[1], cloudShadow.sampler)
  return p.groups.hair.get(named, () => [
    ...localEntries(
      p,
      { ...shared, shadows: { ...shared.shadows, vsmSunMask: suns } },
      { ...r, mask: locals },
      fallback,
    ),
    ...cloudShadowBindEntries(DEFERRED_CLOUD_SHADOW_BINDINGS, cloudShadow),
  ])
}

/** The per-light draw's group: the pixel's layers, the light buffer, the light functions, the mask the
 *  lights are lit through in turn and their records. */
function perLightGroup(
  p: LitState,
  { pixel }: SharedBindings,
  r: Resolved,
  lights: GPUBuffer,
  tileList: GPUBuffer,
  perLight: PerLightLights,
  mask: GPUTextureView,
) {
  const named = p.named.perLight
  named.length = 0
  named.push(pixel.colours, pixel.emissiveAo, pixel.words, pixel.depth, pixel.subsurface)
  named.push(pixel.lobes, lights, tileList, r.lightFunction, mask, perLight.records)
  named.push(r.occlusion, r.toonTables)
  if (p.profiled) named.push(r.lightProfile.view, r.lightProfile.rectView)
  if (p.contact) named.push(r.contactBend.view, r.contactBend.ranks)
  if (p.volume) named.push(r.volumeShadowMaps)
  return p.groups.perLight.get(named, () => [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      lightFunctionAtlas: r.lightFunction,
      ambientOcclusion: r.occlusion,
      perLightMask: mask,
      toonTables: { buffer: r.toonTables },
      perLightRecord: { buffer: perLight.records, size: PER_LIGHT_RECORD_BINDING_BYTES },
    }),
    ...profileEntries(p, r),
    ...contactBendEntries(p, r),
    ...volumeShadowEntries(p, r),
  ])
}

/** The group of the local lights' pass for one light, where the shadowed local lights read the packed mask: the local lights' group and the light's
 *  record. */
function oneLightGroup(
  p: LitState,
  shared: SharedBindings,
  r: Resolved,
  fallback: Fallback,
  perLight: PerLightLights,
) {
  const named = p.named.oneLight
  named.length = 0
  named.push(...p.named.local, perLight.records)
  return p.groups.oneLight.get(named, () => [
    ...localEntries(p, shared, r, fallback),
    {
      binding: DEFERRED_BINDINGS.perLightRecord,
      resource: { buffer: perLight.records, size: PER_LIGHT_RECORD_BINDING_BYTES },
    },
  ])
}

function sunEntries(p: LitState, { pixel, shadows }: SharedBindings, r: Resolved) {
  return [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      ...shadows,
      sunRanks: { buffer: r.sunRanks },
      toonTables: { buffer: r.toonTables },
      ambientOcclusion: r.occlusion,
    }),
    ...cloudShadowBindEntries(DEFERRED_CLOUD_SHADOW_BINDINGS, r.cloudShadow),
    ...contactBendEntries(p, r),
    ...volumeShadowEntries(p, r),
  ]
}

/** The screen-space contact shadows' array and the ranks of its layers, of a program that holds contact shadow code. */
const contactBendEntries = (p: LitState, r: Resolved) =>
  p.contact
    ? [
        { binding: DEFERRED_BINDINGS.contactBend, resource: r.contactBend.view },
        { binding: DEFERRED_BINDINGS.contactBendRanks, resource: { buffer: r.contactBend.ranks } },
      ]
    : []

/** The volumes' shadows' buffer of a program that reads them. */
const volumeShadowEntries = (p: LitState, r: Resolved) =>
  p.volume
    ? [{ binding: DEFERRED_BINDINGS.volumeShadow, resource: { buffer: r.volumeShadowMaps } }]
    : []

/** The light profiles' atlas and sampler of a program that reads them. */
const profileEntries = (p: LitState, r: Resolved) =>
  p.profiled ? lightProfileBindEntries(DEFERRED_LIGHT_PROFILE_BINDINGS, r.lightProfile) : []

function localEntries(
  p: LitState,
  { pixel, shadows }: SharedBindings,
  r: Resolved,
  fallback: Fallback,
) {
  return [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      ...shadows,
      ...fallback,
      vsmMask: r.mask,
      vsmLightGrid: { buffer: r.lightGrid },
      tiles: { buffer: r.tiles },
      toonTables: { buffer: r.toonTables },
      ambientOcclusion: r.occlusion,
    }),
    ...profileEntries(p, r),
    ...contactBendEntries(p, r),
    ...(p.sampled ? [{ binding: DEFERRED_BINDINGS.sampledLight, resource: r.sampledLight }] : []),
    ...volumeShadowEntries(p, r),
  ]
}

function indirectEntries(p: LitState, { pixel }: SharedBindings, r: Resolved) {
  const { bounce, skyShadowing, cubed, capsule, captured } = p
  const { shadowing } = r
  return [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      toonTables: { buffer: r.toonTables },
      ambientOcclusion: r.occlusion,
      volumetricLight: r.lightmapLight,
      reflection: r.reflection,
      ...(bounce && { screenIndirect: r.screen, screenShortRangeGi: r.screenGi }),
      ...(p.closures && {
        screenIndirectClosures: r.screenClosures,
        screenShortRangeGiClosures: r.screenGiClosures,
      }),
      ...(skyShadowing && {
        dfaoBent: { buffer: shadowing.bent },
        dfaoRead: { buffer: shadowing.params },
      }),
      ...(capsule && { capsuleIndirect: { buffer: r.capsuleIndirect } }),
      ...(cubed && {
        ambientCube: r.cube.view,
        ambientCubeSampler: postSamplers(p.device).mipped,
        ambientCubeColour: { buffer: r.cube.colour },
      }),
    }),
    ...skyLightReadBindEntries(DEFERRED_SKY_LIGHT_BINDINGS, r.sky),
    ...(captured
      ? reflectionCaptureBindEntries(DEFERRED_CAPTURE_BINDINGS, reflectionCaptureReadOf(p.device))
      : []),
  ]
}

/** One step of the lit image's light, drawn over the tiles of the surfaces: the sun's pass, the local lights', the shadows' view
 *  (the share of the light they let through), the indirect light's, the toon diffuse's, applied once to the sum of the lights (`toonUnifiedDiffuse`), or, a number, the draw of that shadowed local light alone
 *  (`PerLightLights`, `shadowOnePassProjection` or `clusteredDeferredShading` false), or the indirect pass's variant of the indirect diffuse light alone
 *  (`indirectDiffuse`, view 5: its pipelines made at the first image that asks). */
export type LightStep =
  'suns' | 'locals' | 'visibility' | 'toon' | 'indirect' | 'indirectDiffuse' | number

/** The steps of a lit image in the order they are drawn, by what the view shows (`lightView`, `LIT_VIEWS`, and 4 for the
 *  irradiance the probes bounced, alone, 5 the indirect light on a diffuse grey): the whole lighting (0, 3) is the indirect light's pass, laid on the image before every
 *  light, then the sun's pass, the local lights', each of the `perLight` lights' own draws; 2 the share of the light the shadows
 *  let through; any other the indirect light alone. The one order the batched path (no per-light light: three steps) and the
 *  per-light path both follow. */
export function litSteps(lightView: number, perLight = 0): readonly LightStep[] {
  const key =
    lightView === 2
      ? -1
      : lightView === INDIRECT_DIFFUSE_LIGHT_VIEW
        ? -3
        : lightView === 0 || lightView === 3
          ? perLight
          : -2
  let steps = STEPS.get(key)
  if (!steps)
    STEPS.set(
      key,
      (steps =
        key === -1
          ? ['visibility']
          : key === -2
            ? ['indirect']
            : key === -3
              ? ['indirectDiffuse']
              : ['indirect', 'suns', 'locals', ...Array.from({ length: key }, (_, i) => i)]),
    )
  return steps
}
const STEPS = new Map<number, LightStep[]>()

function drawLit(
  p: LitState,
  pass: GPURenderPassEncoder,
  draws: GPUBuffer,
  step: LightStep,
  perLight?: PerLightLights,
  toonData?: ToonDataViews,
) {
  const { held } = p
  if (!held) throw new Error('SURFACE_NOT_BOUND')
  const draw = (group: GPUBindGroup, pipelines: readonly (GPURenderPipeline | undefined)[]) => {
    pass.setBindGroup(0, group)
    return drawTileClasses(pass, pipelines, draws)
  }
  if (typeof step === 'number') {
    if (!held.perLight || !perLight) throw new Error('SURFACE_NOT_BOUND')
    return p.perLight.drawLight(pass, held.perLight, draws, perLight, step)
  }
  switch (step) {
    // A draw of a kind of light the scene has none of would read every pixel to add nothing.
    case 'suns':
      return held.suns ? draw(held.sun, p.sun.pipelines) : 0
    // The shadowed lights the per-light draws light are left out of the batch, whether those draws are ready or not: a frame
    // that cannot light them yet is drawn again once it can, and reads no mask that was not projected.
    case 'locals':
      return held.locals
        ? draw(held.local, perLight ? p.perLight.unbatchedLocal() : p.local.pipelines)
        : 0
    // The share of the light the shadows let through: the cell's lists, with the mask.
    case 'visibility':
      return draw(
        held.local,
        visibilityPipelines(p).map((pipeline) => pipeline.get()),
      )
    // The toon data the lights added, in a pass of its own: it reads what the pass of the lights wrote.
    case 'toon': {
      if (!toonData || !p.toonDataLayout) throw new Error('the program writes no toon data')
      pass.setBindGroup(
        1,
        p.toonGroup.get([toonData.diffuse, toonData.weights], () => [
          { binding: TOON_DATA_BINDINGS.diffuse, resource: toonData.diffuse },
          { binding: TOON_DATA_BINDINGS.weights, resource: toonData.weights },
        ]),
      )
      return draw(
        held.local,
        toonPipelines(p).map((pipeline) => pipeline?.get()),
      )
    }
    case 'indirect':
      return draw(held.indirect, p.indirect.pipelines)
    case 'indirectDiffuse':
      return draw(
        held.indirect,
        diffuseViewPipelines(p).map((pipeline) => pipeline.get()),
      )
  }
}
