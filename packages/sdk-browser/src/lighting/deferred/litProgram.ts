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
  DEFERRED_SKY_LIGHT_BINDINGS,
} from './bindings.ts'
import type { ContractKey } from './contractCuts.ts'
import { indirectPassWgsl } from './indirectPassWgsl.ts'
import {
  hairLayoutEntries,
  indirectLayoutEntries,
  localLayoutEntries,
  sunLayoutEntries,
} from './layoutEntries.ts'
import { localPassWgsl, sunPassWgsl } from './lightPassWgsl.ts'
import { buildRenderPipeline, preparedPipeline, type PreparedPipeline } from './fullscreen.ts'
import { createPassGroup } from './passGroup.ts'
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
        lightPipelineDescriptor(device, modules, layout, entry, label, tileClass),
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
    contact = !key.contactless,
    sampled = !!key.sampled,
    volume = !!key.volumeShadow
  const layouts = litLayouts(device, {
    bounce,
    skyShadowing,
    capsule,
    lobes,
    profiled,
    cubed,
    contact,
    sampled,
    volume,
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
    contact,
    sampled,
    volume,
    label,
    key,
    layouts,
    ...passes,
    perLight,
    groups: litGroups(device, layouts, perLight.layout),
    // What the groups name, in a fixed order, so that a frame whose resources did not move allocates
    // nothing (`createPassGroup`).
    named: { sun: [], local: [], indirect: [], perLight: [], hair: [] },
  }

  return {
    /** Whether it reads the probes' light. */
    bounce,
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
    contact: boolean
    sampled: boolean
    volume: boolean
  },
) {
  const { bounce, skyShadowing, capsule, lobes, profiled, cubed, contact, sampled, volume } = f
  return {
    sun: device.createBindGroupLayout({ entries: sunLayoutEntries(lobes, contact, volume) }),
    local: device.createBindGroupLayout({
      entries: localLayoutEntries(lobes, profiled, contact, sampled, volume),
    }),
    indirect: device.createBindGroupLayout({
      entries: indirectLayoutEntries({ bounce, skyShadowing, lobes, cubed, capsule }),
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
  perLightLayout: GPUBindGroupLayout,
) {
  return {
    sun: createPassGroup(device, layouts.sun),
    local: createPassGroup(device, layouts.local),
    hair: createPassGroup(device, layouts.hair),
    indirect: createPassGroup(device, layouts.indirect),
    perLight: createPassGroup(device, perLightLayout),
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
     * path of `shadowOnePassProjection` false is taken: the local lights' step leaves out the shadowed lights, and the steps
     * `litSteps` lists for them, a light each, draw them (`PerLightProgram.drawLight`). Returns the draws made.
     */
    drawStep(
      pass: GPURenderPassEncoder,
      draws: GPUBuffer,
      step: LightStep,
      perLight?: PerLightLights,
    ) {
      return drawLit(p, pass, draws, step, perLight)
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
    /** Whether the pipelines of the per-light path are compiled (`createPerLightProgram`); the frames wait for them otherwise. */
    perLightReady: () => p.perLight.ready(),
    release() {
      for (const group of Object.values(p.groups)) group.release()
      p.held = undefined
    },
  }
}

type LitLayouts = Record<'sun' | 'local' | 'indirect' | 'hair', GPUBindGroupLayout>

/** The pipelines of the three passes, made together. */
async function litPasses(device: GPUDevice, sources: LitSources, layouts: LitLayouts) {
  const { bounce, key, skyShadowing, capsule, label } = sources
  const classes = classesOf(key)
  const [sun, local, indirect] = await Promise.all([
    passPipelines(
      device,
      classes,
      (c) => sunPassWgsl(key, c),
      'sunMain',
      layouts.sun,
      `${label}_SUN`,
    ),
    passPipelines(
      device,
      classes,
      (c) => localPassWgsl(key, c),
      'localMain',
      layouts.local,
      `${label}_LOCAL`,
    ),
    passPipelines(
      device,
      classes,
      (c) =>
        indirectPassWgsl({ bounce, skyShadowing, cubed: !key.cubeless, capsule, tileClass: c }),
      'indirectMain',
      layouts.indirect,
      `${label}_INDIRECT`,
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
  /** The per-light draw's group, where the frame lights the shadowed local lights one by one (`DirectLightResources.perLight`). */
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
  /** Whether the passes of lights hold contact shadow code (`ContractKey.contactless`): they bind the screen-space shadows' array and its layers' ranks. */
  readonly contact: boolean
  /** Whether the local lights' pass adds the light the sampled lighting left (`ContractKey.sampled`): it binds that light's texture. */
  readonly sampled: boolean
  /** Whether the passes of lights read the volumes' shadows (`ContractKey.volumeShadow`): they bind the packed buffer. */
  readonly volume: boolean
  readonly label: string
  /** The key of the lights the program lights. */
  readonly key: ContractKey
  readonly layouts: LitLayouts
  readonly sun: Awaited<ReturnType<typeof passPipelines>>
  readonly local: Awaited<ReturnType<typeof passPipelines>>
  readonly indirect: Awaited<ReturnType<typeof passPipelines>>
  readonly groups: Record<
    'sun' | 'local' | 'indirect' | 'perLight' | 'hair',
    ReturnType<typeof createPassGroup>
  >
  readonly named: Record<'sun' | 'local' | 'indirect' | 'perLight' | 'hair', unknown[]>
  /** The per-light passes, whose pipelines are made at the first frame that takes the path. */
  readonly perLight: PerLightProgram
  held?: HeldGroups
  /** The pipelines of the shadows' view, made at the first image that shows it, from the module of
   *  the class that holds its code (`localPassWgsl`). */
  visibility?: PreparedPipeline<GPURenderPipeline>[]
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
      ),
    ),
  ))
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
    farMask: direct.farShadowMask ?? placeholders.farShadowMask,
    lightFunction: direct.lightFunction ?? placeholders.lightFunction,
    lightProfile: direct.lightProfile ?? placeholders.lightProfile,
    contactBend: direct.contactBend ?? placeholders.contactBend,
    sampledLight: direct.sampledLight ?? placeholders.volumetricLight,
    volumeShadowMaps: direct.volumeShadowMaps ?? placeholders.volumeShadowMaps,
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
  sunNamed.push(surface, depth, lights, tileList, r.sunRanks, r.sunMask, r.farMask)
  sunNamed.push(r.lightFunction, cloudShadow.block, cloudShadow.maps[0], cloudShadow.maps[1])
  sunNamed.push(cloudShadow.sampler, r.occlusion)
  if (p.contact) sunNamed.push(r.contactBend.view, r.contactBend.ranks)
  if (p.volume) sunNamed.push(r.volumeShadowMaps)
  localNamed.length = 0
  localNamed.push(surface, depth, lights, tileList, r.tiles, r.mask, r.sunMask)
  localNamed.push(r.lightFunction, r.farMask, r.lightGrid, r.occlusion)
  // The atlas's view changes only when its texture is made: the group follows it.
  if (p.profiled) localNamed.push(r.lightProfile.view)
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
  indirectNamed.push(r.lightmapLight)
  indirectNamed.push(sky.sampler, sky.harmonics, sky.params)
  if (p.bounce) indirectNamed.push(r.screen)
  if (p.skyShadowing) indirectNamed.push(shadowing.bent, shadowing.params)
  if (p.capsule) indirectNamed.push(r.capsuleIndirect)
  if (p.cubed) indirectNamed.push(r.cube.view, r.cube.colour)
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
    perLight: direct.perLight && perLightGroup(p, shared, r, lights, tileList, direct.perLight),
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
) {
  const named = p.named.perLight
  named.length = 0
  named.push(pixel.colours, pixel.emissiveAo, pixel.words, pixel.depth, pixel.subsurface)
  named.push(pixel.lobes, lights, tileList, r.lightFunction, perLight.mask, perLight.records)
  named.push(r.occlusion)
  if (p.profiled) named.push(r.lightProfile.view)
  if (p.contact) named.push(r.contactBend.view, r.contactBend.ranks)
  if (p.volume) named.push(r.volumeShadowMaps)
  return p.groups.perLight.get(named, () => [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      lightFunctionAtlas: r.lightFunction,
      ambientOcclusion: r.occlusion,
      perLightMask: perLight.mask,
      perLightRecord: { buffer: perLight.records, size: PER_LIGHT_RECORD_BINDING_BYTES },
    }),
    ...profileEntries(p, r),
    ...contactBendEntries(p, r),
    ...volumeShadowEntries(p, r),
  ])
}

function sunEntries(p: LitState, { pixel, shadows }: SharedBindings, r: Resolved) {
  return [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      ...shadows,
      sunRanks: { buffer: r.sunRanks },
      farShadowMask: { buffer: r.farMask },
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
      farShadowMask: { buffer: r.farMask },
      ambientOcclusion: r.occlusion,
    }),
    ...profileEntries(p, r),
    ...contactBendEntries(p, r),
    ...(p.sampled ? [{ binding: DEFERRED_BINDINGS.sampledLight, resource: r.sampledLight }] : []),
    ...volumeShadowEntries(p, r),
  ]
}

function indirectEntries(p: LitState, { pixel }: SharedBindings, r: Resolved) {
  const { bounce, skyShadowing, cubed, capsule } = p
  const { shadowing } = r
  return [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      ambientOcclusion: r.occlusion,
      volumetricLight: r.lightmapLight,
      reflection: r.reflection,
      ...(bounce && { screenIndirect: r.screen, screenShortRangeGi: r.screenGi }),
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
  ]
}

/** One step of the lit image's light, drawn over the tiles of the surfaces: the sun's pass, the local lights', the shadows' view
 *  (the share of the light they let through), the indirect light's, or, a number, the draw of that shadowed local light alone
 *  (`PerLightLights`, `shadowOnePassProjection` false). */
export type LightStep = 'suns' | 'locals' | 'visibility' | 'indirect' | number

/** The steps of a lit image in the order they are drawn, by what the view shows (`lightView`, `LIT_VIEWS`, and 4 for the
 *  irradiance the probes bounced, alone): the whole lighting (0, 3) is the indirect light's pass, laid on the image before every
 *  light, then the sun's pass, the local lights', each of the `perLight` lights' own draws; 2 the share of the light the shadows
 *  let through; any other the indirect light alone. The one order the batched path (no per-light light: three steps) and the
 *  per-light path both follow. */
export function litSteps(lightView: number, perLight = 0): readonly LightStep[] {
  const key = lightView === 2 ? -1 : lightView === 0 || lightView === 3 ? perLight : -2
  let steps = STEPS.get(key)
  if (!steps)
    STEPS.set(
      key,
      (steps =
        key === -1
          ? ['visibility']
          : key === -2
            ? ['indirect']
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
    case 'indirect':
      return draw(held.indirect, p.indirect.pipelines)
  }
}
