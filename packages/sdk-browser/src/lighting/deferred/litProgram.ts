import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { cloudShadowBindEntries } from '../atmosphere/cloudShadowRead.ts'
import { cloudShadowStandIn } from '../atmosphere/cloudShadowStandIn.ts'
import { skyLightReadBindEntries } from '../../modules/sky/skyLight/read.ts'
import { skyLightStandIn } from '../../modules/sky/skyLight/standIn.ts'
import {
  DEFERRED_BINDINGS,
  DEFERRED_CLOUD_SHADOW_BINDINGS,
  DEFERRED_SKY_LIGHT_BINDINGS,
} from './bindings.ts'
import type { ContractKey } from './contractCuts.ts'
import { indirectPassWgsl } from './indirectPassWgsl.ts'
import { indirectLayoutEntries, localLayoutEntries, sunLayoutEntries } from './layoutEntries.ts'
import { localPassWgsl, sunPassWgsl } from './lightPassWgsl.ts'
import { preparedPipeline, type PreparedPipeline } from './fullscreen.ts'
import { createPassGroup } from './passGroup.ts'
import type { DeferredBindings, DirectLightResources } from './program.ts'
import {
  ADDITIVE_LIGHT,
  drawTileClasses,
  tilePipeline,
  tilePipelineDescriptor,
} from './tilePass.ts'
import { TILE_CLASS, TILE_CLASSES, type TileClass } from './tileClass.ts'

/** What a program is made from: whether it reads the probes (`bounce`), the key of the lights it
 *  lights (`ContractKey`: its list width, its cuts of shadow, rectangle and lobe code), whether it
 *  applies the sky light's distance-field occlusion (`skyShadowing`), and its name. */
export interface LitSources {
  bounce: boolean
  key: ContractKey
  skyShadowing: boolean
  label: string
}

/** The name of a class in a label. */
const CLASS_NAMES = ['SIMPLE', 'SINGLE', 'COMPLEX'] as const

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
        `${label}_${CLASS_NAMES[tileClass]}`,
      ),
    ),
  )
  const targets: GPUColorTargetState[] = [{ format: HDR_FORMAT, blend: ADDITIVE_LIGHT }]
  const pipelines = await Promise.all(
    TILE_CLASSES.map((tileClass) =>
      tilePipeline(
        device,
        modules[Math.min(tileClass, modules.length - 1)],
        layout,
        entry,
        targets,
        `${label}_${CLASS_NAMES[tileClass]}`,
        tileClass,
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
  const { bounce, key, skyShadowing, label } = sources
  const lobes = !key.lobeless
  const layouts = {
    sun: device.createBindGroupLayout({ entries: sunLayoutEntries(lobes) }),
    local: device.createBindGroupLayout({ entries: localLayoutEntries(lobes) }),
    indirect: device.createBindGroupLayout({
      entries: indirectLayoutEntries({ bounce, skyShadowing, lobes }),
    }),
  }
  const passes = await litPasses(device, sources, layouts)
  const p: LitState = {
    device,
    uniform: bindings.uniform,
    placeholders: bindings.placeholders,
    bounce,
    skyShadowing,
    lobes,
    label,
    layouts,
    ...passes,
    groups: {
      sun: createPassGroup(device, layouts.sun),
      local: createPassGroup(device, layouts.local),
      indirect: createPassGroup(device, layouts.indirect),
    },
    // What the groups name, in a fixed order, so that a frame whose resources did not move allocates
    // nothing (`createPassGroup`).
    named: { sun: [], local: [], indirect: [] },
  }

  return {
    /** Whether it reads the probes' light. */
    bounce,
    ...litCalls(p),
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
     * Records into `pass`, the lit image's one render pass with its viewport set and the surfaces'
     * colour already drawn (`createSurfaceColourPass`), the light added over the tiles `draws` lists
     * (`createTileClassification`'s `draws`) — the sun's draws, the local lights', the indirect
     * light's. One pass for the colour and the lights: a tiled GPU loads the image into its tile
     * memory and stores it once instead of once a pass, and the additive blends are the same sums in
     * the same order. `lightView` (`LIT_VIEWS`, and 4 for the irradiance the probes bounced, alone)
     * says what the view shows: the whole lighting, or the one term — 1 the reflection, 4 the
     * bounce — of the indirect draw, or — 2 — the share of the light the shadows let through.
     * Returns the light's draws made.
     */
    draws(pass: GPURenderPassEncoder, draws: GPUBuffer, lightView: number) {
      return drawLit(p, pass, draws, lightView)
    },
    release() {
      for (const group of Object.values(p.groups)) group.release()
      p.held = undefined
    },
  }
}

type LitLayouts = Record<'sun' | 'local' | 'indirect', GPUBindGroupLayout>

/** The pipelines of the three passes, made together. */
async function litPasses(device: GPUDevice, sources: LitSources, layouts: LitLayouts) {
  const { bounce, key, skyShadowing, label } = sources
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
      (c) => indirectPassWgsl({ bounce, skyShadowing, tileClass: c }),
      'indirectMain',
      layouts.indirect,
      `${label}_INDIRECT`,
    ),
  ])
  return { sun, local, indirect }
}

/** The groups of the last `bind`. */
interface HeldGroups {
  sun: GPUBindGroup
  local: GPUBindGroup
  indirect: GPUBindGroup
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
  readonly lobes: boolean
  readonly label: string
  readonly layouts: LitLayouts
  readonly sun: Awaited<ReturnType<typeof passPipelines>>
  readonly local: Awaited<ReturnType<typeof passPipelines>>
  readonly indirect: Awaited<ReturnType<typeof passPipelines>>
  readonly groups: Record<'sun' | 'local' | 'indirect', ReturnType<typeof createPassGroup>>
  readonly named: Record<'sun' | 'local' | 'indirect', unknown[]>
  held?: HeldGroups
  /** The pipelines of the shadows' view, made at the first image that shows it, from the module of
   *  the class that holds its code (`localPassWgsl`). */
  visibility?: PreparedPipeline<GPURenderPipeline>[]
}

function visibilityPipelines(p: LitState) {
  return (p.visibility ??= TILE_CLASSES.map((tileClass) =>
    preparedPipeline(
      p.device,
      tilePipelineDescriptor(
        p.device,
        p.local.modules[Math.min(TILE_CLASS.single, p.local.modules.length - 1)],
        p.layouts.local,
        'visibilityMain',
        [{ format: HDR_FORMAT, blend: ADDITIVE_LIGHT }],
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
    tiles: direct.tiles ?? placeholders.tiles,
    sunRanks: direct.sunRanks ?? placeholders.sunRanks,
    mask: direct.vsmMask ?? placeholders.vsmMask,
    lightGrid: direct.vsmLightGrid ?? placeholders.vsmLightGrid,
    sunMask: direct.vsmSunMask ?? placeholders.vsmSunMask,
    farMask: direct.farShadowMask ?? placeholders.farShadowMask,
    lightFunction: direct.lightFunction ?? placeholders.lightFunction,
    cloudShadow: direct.cloudShadow ?? cloudShadowStandIn(device),
    sky: direct.sky ?? skyLightStandIn(device),
    reflection: direct.reflection ?? placeholders.reflection,
    occlusion: direct.ambientOcclusion ?? placeholders.ambientOcclusion,
    lightmapLight: direct.volumetricLight ?? placeholders.volumetricLight,
    screen: direct.screenIndirect ?? placeholders.screenIndirect,
    shadowing: direct.skyShadowing ?? placeholders.skyShadowing,
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
  sunNamed.push(cloudShadow.sampler)
  localNamed.length = 0
  localNamed.push(surface, depth, lights, tileList, r.tiles, r.mask, r.sunMask)
  localNamed.push(r.lightFunction, r.farMask, r.lightGrid)
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
  const { bounce, skyShadowing, groups, named } = p
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
    sun: groups.sun.get(named.sun, () => sunEntries(shared, r)),
    local: groups.local.get(named.local, () => localEntries(shared, r, fallback)),
    indirect: groups.indirect.get(named.indirect, () =>
      indirectEntries(shared, r, direct, bounce, skyShadowing),
    ),
    suns: direct.suns !== 0,
    locals: direct.locals !== 0,
  }
}

function sunEntries({ pixel, shadows }: SharedBindings, r: Resolved) {
  return [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      ...shadows,
      sunRanks: { buffer: r.sunRanks },
      farShadowMask: { buffer: r.farMask },
    }),
    ...cloudShadowBindEntries(DEFERRED_CLOUD_SHADOW_BINDINGS, r.cloudShadow),
  ]
}

function localEntries({ pixel, shadows }: SharedBindings, r: Resolved, fallback: Fallback) {
  return namedEntries(DEFERRED_BINDINGS, {
    ...pixel,
    ...shadows,
    ...fallback,
    vsmMask: r.mask,
    vsmLightGrid: { buffer: r.lightGrid },
    tiles: { buffer: r.tiles },
    farShadowMask: { buffer: r.farMask },
  })
}

function indirectEntries(
  { pixel }: SharedBindings,
  r: Resolved,
  direct: DirectLightResources,
  bounce: boolean,
  skyShadowing: boolean,
) {
  const { shadowing } = r
  return [
    ...namedEntries(DEFERRED_BINDINGS, {
      ...pixel,
      ambientOcclusion: r.occlusion,
      volumetricLight: r.lightmapLight,
      reflection: r.reflection,
      ...(bounce && { screenIndirect: r.screen }),
      ...(skyShadowing && {
        dfaoBent: { buffer: shadowing.bent },
        dfaoRead: { buffer: shadowing.params },
      }),
    }),
    ...skyLightReadBindEntries(DEFERRED_SKY_LIGHT_BINDINGS, r.sky),
  ]
}

function drawLit(p: LitState, pass: GPURenderPassEncoder, draws: GPUBuffer, lightView: number) {
  const { held } = p
  if (!held) throw new Error('SURFACE_NOT_BOUND')
  let made = 0
  const draw = (group: GPUBindGroup, pipelines: readonly (GPURenderPipeline | undefined)[]) => {
    pass.setBindGroup(0, group)
    made += drawTileClasses(pass, pipelines, draws)
  }
  if (lightView === 2) {
    // The share of the light the shadows let through: the cell's lists, with the mask.
    draw(
      held.local,
      visibilityPipelines(p).map((pipeline) => pipeline.get()),
    )
  } else {
    if (lightView === 0 || lightView === 3) {
      // A draw of a kind of light the scene has none of would read every pixel to add nothing.
      if (held.suns) draw(held.sun, p.sun.pipelines)
      if (held.locals) draw(held.local, p.local.pipelines)
    }
    draw(held.indirect, p.indirect.pipelines)
  }
  return made
}
