import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import {
  capsuleDirectOn,
  capsuleIndirectOn,
  type CapsuleShadowSettings,
} from '../../../../sdk-core/src/contracts/capsuleShadowOptions.ts'
import { skyLightDiffuseBindEntries } from '../../modules/sky/skyLight/read.ts'
import type { SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import { namedEntries, wholeBuffer } from '../../gpu/core/computeBindings.ts'
import { hizLevelZeroBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import type { MeshFieldScene } from '../distanceField/meshFieldScene.ts'
import type { VolumetricLightmapGpu } from '../volumetricLightmap/gpu.ts'
import {
  CAPSULE_BINDINGS as B,
  LIGHT_DIRECTION_BINDINGS as L,
  LIGHT_DIRECTION_SKY,
  LIGHT_DIRECTION_PARAM_FLOATS,
  UPSAMPLE_BINDINGS as U,
  UPSAMPLE_PARAM_FLOATS,
} from './layout.ts'
import {
  capsuleCamera,
  capsuleDepthTerms,
  capsuleDownsample,
  capsuleGrid,
  createCapsuleParams,
  lightDirectionGroups,
  skyLightMode,
  writeCapsuleParams,
  writeLightDirectionParams,
  writeUpsampleParams,
  type CapsuleLight,
} from './plan.ts'
import { capsulePrograms, type CapsuleProgramKey } from './pipelines.ts'
import { CAPSULE_SHAPE_FLOATS, LIGHT_DIRECTION_WORDS } from './shapes.ts'
import {
  BLOCK_BYTES,
  CAPSULE_SLOTS,
  capsuleRoom,
  ensureCapsuleView,
  slotOffsets,
  windowOf,
  type CapsuleView,
} from './view.ts'

const LABEL = 'Trillion3D capsule shadows'
const SHADOW_PASS: GPUComputePassDescriptor = { label: `${LABEL} shadow` }
const COMPOSE_PASS: GPUComputePassDescriptor = { label: `${LABEL} compose` }
const DIRECTIONS_PASS: GPUComputePassDescriptor = { label: `${LABEL} light directions` }

/**
 * THE BLENDS OF THE UPSAMPLE'S TARGETS: a light's shadow takes the minimum of what the mask holds and the capsules' (`min` on each of the colour
 * and the alpha, the target's write mask the channel the light holds); the indirect shadow multiplies the scene's colour (`dst` times the source on
 * the colour channels) and, in a second target with the same blend, the ambient occlusion (a write mask of the red channel).
 */
export const CAPSULE_BLENDS = {
  attenuation: {
    color: { operation: 'min', srcFactor: 'one', dstFactor: 'one' },
    alpha: { operation: 'min', srcFactor: 'one', dstFactor: 'one' },
  },
  modulate: {
    color: { operation: 'add', srcFactor: 'dst', dstFactor: 'zero' },
    alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one' },
  },
} as const satisfies Record<string, GPUBlendState>

/** What the host holds of a view's capsule shadows between images. */
export interface CapsuleState {
  view: CapsuleView | undefined
  /** Why the shadows were not drawn, where the budget refused them. */
  why: string | undefined
  /** The next free slot of the image (`beginCapsuleImage`). */
  slot: number
}

export const createCapsuleState = (): CapsuleState => ({ view: undefined, why: undefined, slot: 0 })

/** Starts an image: the passes take their slots from the first. */
export const beginCapsuleImage = (state: CapsuleState) => void (state.slot = 0)

/** What the passes read of the frame. */
export interface CapsuleSources {
  readonly depth: HizDepth
  /** The surfaces' flags (`texture_2d<u32>`), per pixel. */
  readonly flags: GPUTextureView
  /** The meshes' distance fields, for the casters of the indirect shadow. */
  readonly objects?: Pick<MeshFieldScene, 'bindEntries' | 'generation' | 'count'>
  /** The volumetric lightmap, where the session has one: the light directions are derived from it on the GPU. */
  readonly lightmap?: VolumetricLightmapGpu
  /** The sky light's harmonics: the light directions are derived from them on the GPU where the lightmap gives none. */
  readonly sky?: SkyLightReadSet
}

/** The image the shadows are drawn for. */
export interface CapsuleImage {
  /** The size drawn and the size of the buffers, in pixels. */
  readonly view: readonly [number, number]
  readonly extent: readonly [number, number]
  readonly projection: ArrayLike<number>
  /** The camera's world matrix. */
  readonly world: ArrayLike<number>
  readonly perspective: boolean
  readonly near: number
  readonly far: number
  /** The translation the shapes were written with (`writeShadowShapes`). */
  readonly preViewTranslation: readonly [number, number, number]
}

/** The data of a pass: the shapes, and for the indirect kinds the light records. */
export interface CapsuleData {
  /** `count` shapes of `CAPSULE_SHAPE_FLOATS` floats. */
  readonly shapes: Float32Array
  readonly count: number
  /** For the indirect kinds, a record a shape, then a record a distance-field caster (`LIGHT_DIRECTION_WORDS` words each). */
  readonly records?: Uint32Array
  /** The distance fields' objects that cast, for the indirect shadow. */
  readonly casters?: Uint32Array
  /** The records hold positions the GPU turns into directions (`lightDirectionWgsl.ts`): the sky light's kind, which says which source gives them. */
  readonly derive?: {
    readonly sky: { wantsStaticShadowing: boolean; realTimeCapture: boolean } | undefined
  }
}

/** The targets of the upsample: what it draws into and how it blends. */
interface CapsuleOutput {
  readonly targets: readonly GPUColorTargetState[]
  readonly attachments: readonly GPURenderPassColorAttachment[]
}

const paramFloats = createCapsuleParams()
const upsampleFloats = new Float32Array(UPSAMPLE_PARAM_FLOATS)
const directionFloats = new Float32Array(LIGHT_DIRECTION_PARAM_FLOATS)

/** A bind group kept on the view while what it names is the same. */
interface Kept {
  over: unknown[]
  group: GPUBindGroup
}

function kept(view: CapsuleView, key: string, over: unknown[], make: () => GPUBindGroup) {
  const held = view.groups.get(key) as Kept | undefined
  if (held && sameValues(held.over, over)) return held.group
  const group = make()
  view.groups.set(key, { over, group } satisfies Kept)
  return group
}

/** Everything one pass shares, worked out once. */
interface Pass {
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly view: CapsuleView
  readonly slot: number
  readonly key: CapsuleProgramKey
  readonly image: CapsuleImage
  readonly sources: CapsuleSources
  readonly data: CapsuleData
  readonly settings: CapsuleShadowSettings
}

/** The view for a pass of `data`, with room for it (the room only grows); none, and the state says why, where the pass cannot be drawn. */
function ensureView(
  state: CapsuleState,
  device: GPUDevice,
  image: CapsuleImage,
  data: CapsuleData,
  downsample: number,
  bent: readonly [number, number] | undefined,
) {
  if (state.slot >= CAPSULE_SLOTS) {
    state.why = `more than ${CAPSULE_SLOTS} capsule shadow passes in an image`
    return undefined
  }
  const held = state.view?.shape
  const records = data.records ? data.records.length / LIGHT_DIRECTION_WORDS : 0
  const { view, why } = ensureCapsuleView(state.view, device, {
    extent: image.extent,
    downsample,
    shapes: Math.max(held?.shapes ?? 0, capsuleRoom(data.count)),
    records: Math.max(held?.records ?? 0, capsuleRoom(records)),
    casters: Math.max(held?.casters ?? 0, capsuleRoom(data.casters?.length ?? 0)),
    bent: bent ?? held?.bent,
  })
  state.view = view
  state.why = why
  return view
}

/** Writes the pass's data into its windows of the view's buffers. */
function upload(pass: Pass) {
  const { device, view, slot, data } = pass
  const at = slotOffsets(view, slot)
  device.queue.writeBuffer(
    view.shapes,
    at.shapes,
    data.shapes.buffer,
    data.shapes.byteOffset,
    data.count * CAPSULE_SHAPE_FLOATS * 4,
  )
  if (data.records)
    device.queue.writeBuffer(
      view.lights,
      at.lights,
      data.records.buffer,
      data.records.byteOffset,
      data.records.byteLength,
    )
  if (data.casters)
    device.queue.writeBuffer(
      view.casters,
      at.casters,
      data.casters.buffer,
      data.casters.byteOffset,
      data.casters.byteLength,
    )
}

/** The light directions, derived on the GPU into the pass's window of the derived records, which the shadow pass then reads: from the volumetric
 *  lightmap where the session has one, else from the sky light's harmonics. */
function deriveDirections(pass: Pass, programs: ReturnType<typeof capsulePrograms>) {
  const { device, encoder, view, slot, data, sources, settings } = pass
  const { derive, records } = data
  const { lightmap, sky } = sources
  if (!derive || !records || !sky) return false
  const stage = programs.directions(!!lightmap).get()
  if (!stage) return false
  const at = slotOffsets(view, slot)
  const count = records.length / LIGHT_DIRECTION_WORDS
  writeLightDirectionParams(directionFloats, count, skyLightMode(derive.sky), settings)
  device.queue.writeBuffer(view.directionParams, at.directionParams, directionFloats)
  const [paramsLayout, lightmapLayout, skyLayout] = programs.directionLayouts
  const group = kept(view, `directions ${slot}`, [], () =>
    device.createBindGroup({
      label: `${LABEL} light directions`,
      layout: paramsLayout,
      entries: [
        {
          binding: L.params,
          resource: windowOf(
            view.directionParams,
            at.directionParams,
            LIGHT_DIRECTION_PARAM_FLOATS * 4,
          ),
        },
        { binding: L.input, resource: windowOf(view.lights, at.lights, view.window.lights) },
        {
          binding: L.output,
          resource: windowOf(view.derivedLights, at.lights, view.window.lights),
        },
      ],
    }),
  )
  const lightmapGroup = lightmap
    ? kept(view, 'lightmap', [lightmap], () =>
        device.createBindGroup({
          label: `${LABEL} lightmap`,
          layout: lightmapLayout,
          entries: lightmap.entries(0),
        }),
      )
    : kept(view, 'no lightmap', [], () =>
        device.createBindGroup({
          label: `${LABEL} no lightmap`,
          layout: programs.noLightmapLayout,
          entries: [],
        }),
      )
  const skyGroup = kept(view, 'sky', [sky.harmonics, sky.params], () =>
    device.createBindGroup({
      label: `${LABEL} sky`,
      layout: skyLayout,
      entries: skyLightDiffuseBindEntries(LIGHT_DIRECTION_SKY, sky),
    }),
  )
  const compute = encoder.beginComputePass(DIRECTIONS_PASS)
  compute.setPipeline(stage)
  compute.setBindGroup(0, group)
  compute.setBindGroup(1, lightmapGroup)
  compute.setBindGroup(2, skyGroup)
  compute.dispatchWorkgroups(lightDirectionGroups(count))
  compute.end()
  return true
}

/** The bind groups of the shadow pass: group 0 over the pass's windows, and the fields' scene as group 1 where the casters are traced. */
function shadowGroups(
  pass: Pass,
  layouts: readonly GPUBindGroupLayout[],
  derived: boolean,
  receiver: GPUTextureView | undefined,
) {
  const { device, view, slot, key, sources, data } = pass
  const at = slotOffsets(view, slot)
  const bent = key.mode === 'skylight'
  const over = [sources.depth, sources.flags, derived, receiver, view]
  const group0 = kept(view, `shadow ${key.mode} ${key.casters} ${slot}`, over, () => {
    const resources: Partial<Record<keyof typeof B, GPUBindingResource>> = {
      params: windowOf(view.params, at.params, BLOCK_BYTES.params),
      shapes: windowOf(view.shapes, at.shapes, view.window.shapes),
      flags: sources.flags,
    }
    if (data.records && (key.mode === 'indirect' || bent))
      resources.lightData = windowOf(
        derived ? view.derivedLights : view.lights,
        at.lights,
        view.window.lights,
      )
    if (key.casters)
      resources.casterIndices = windowOf(view.casters, at.casters, view.window.casters)
    if (bent) {
      resources.receiverBentNormal = receiver
      resources.bentNormal = view.bent?.view
    } else {
      resources.tileCounts = wholeBuffer(view.tileCounts)
      resources.factors = view.factors.view
    }
    return device.createBindGroup({
      label: `${LABEL} shadow`,
      layout: layouts[0],
      entries: [...namedEntries(B, resources), ...hizLevelZeroBindEntries(B.depth, sources.depth)],
    })
  })
  if (!key.casters || !sources.objects) return [group0] as const
  const objects = sources.objects
  const group1 = kept(view, 'scene', [objects.generation], () =>
    device.createBindGroup({
      label: `${LABEL} scene`,
      layout: layouts[1],
      entries: objects.bindEntries(0),
    }),
  )
  return [group0, group1] as const
}

/** A layer of the suns' mask (`r32float`, the visibility itself): the capsule shadow is taken into it by a composition, the minimum of what it holds
 *  and the shadow. */
export interface CapsuleSunOutput {
  readonly sunMask: GPUTextureView
  readonly layer: number
}

const isSunOutput = (output: CapsuleOutput | CapsuleSunOutput): output is CapsuleSunOutput =>
  'sunMask' in output

/** The composition of a pass into a layer of a sun's mask, over the pixels of the tiles that met a shape. */
function compose(
  pass: Pass,
  programs: ReturnType<typeof capsulePrograms>,
  output: CapsuleSunOutput,
  grid: ReturnType<typeof capsuleGrid>,
  scissor: readonly [number, number, number, number],
) {
  const { device, encoder, view, slot, image, sources, settings } = pass
  const stage = programs.composeSun.get()
  if (!stage) return
  const at = slotOffsets(view, slot)
  writeUpsampleParams(upsampleFloats, {
    scissor,
    viewport: [0, 0, image.view[0], image.view[1]],
    extent: image.extent,
    downsample: view.shape.downsample,
    grid,
    attenuation: false,
    selfShadowIntensity: settings.capsuleIndirectSelfShadowingIntensity,
    layer: output.layer,
    depth: capsuleDepthTerms(image),
  })
  device.queue.writeBuffer(view.upsampleParams, at.upsampleParams, upsampleFloats)
  const group = device.createBindGroup({
    label: `${LABEL} compose`,
    layout: programs.composeLayout,
    entries: [
      {
        binding: U.params,
        resource: windowOf(view.upsampleParams, at.upsampleParams, BLOCK_BYTES.upsampleParams),
      },
      { binding: U.tileCounts, resource: wholeBuffer(view.tileCounts) },
      { binding: U.factors, resource: view.factors.view },
      { binding: U.sunMask, resource: output.sunMask },
      ...hizLevelZeroBindEntries(U.depth, sources.depth),
      { binding: U.flags, resource: sources.flags },
    ],
  })
  const compute = encoder.beginComputePass(COMPOSE_PASS)
  compute.setPipeline(stage)
  compute.setBindGroup(0, group)
  compute.dispatchWorkgroups(ceilDiv(scissor[2], 8), ceilDiv(scissor[3], 8))
  compute.end()
}

/** The upsample draw of a pass over the tiles that met a shape. */
function upsample(
  pass: Pass,
  programs: ReturnType<typeof capsulePrograms>,
  output: CapsuleOutput,
  grid: ReturnType<typeof capsuleGrid>,
  rect: {
    scissor: readonly [number, number, number, number]
    viewport: readonly [number, number, number, number]
  },
  attenuation: boolean,
) {
  const { device, encoder, view, slot, image, sources, settings } = pass
  const stage = programs.upsample({ targets: output.targets }).get()
  if (!stage) return
  const at = slotOffsets(view, slot)
  const downsample = view.shape.downsample
  writeUpsampleParams(upsampleFloats, {
    ...rect,
    extent: image.extent,
    downsample,
    grid,
    attenuation,
    selfShadowIntensity: settings.capsuleIndirectSelfShadowingIntensity,
    depth: capsuleDepthTerms(image),
  })
  device.queue.writeBuffer(view.upsampleParams, at.upsampleParams, upsampleFloats)
  const group = kept(view, `upsample ${slot}`, [sources.depth, sources.flags, view], () =>
    device.createBindGroup({
      label: `${LABEL} upsample`,
      layout: programs.upsampleLayout,
      entries: [
        {
          binding: U.params,
          resource: windowOf(view.upsampleParams, at.upsampleParams, BLOCK_BYTES.upsampleParams),
        },
        { binding: U.tileCounts, resource: wholeBuffer(view.tileCounts) },
        { binding: U.factors, resource: view.factors.view },
        ...hizLevelZeroBindEntries(U.depth, sources.depth),
        { binding: U.flags, resource: sources.flags },
      ],
    }),
  )
  const draw = encoder.beginRenderPass({
    label: `${LABEL} upsample`,
    colorAttachments: [...output.attachments],
  })
  const [x, y, width, height] = rect.viewport
  draw.setViewport(x, y, width, height, 0, 1)
  draw.setScissorRect(...rect.scissor)
  draw.setPipeline(stage)
  draw.setBindGroup(0, group)
  draw.draw(6, grid.tilesAcross * grid.tilesDown)
  draw.end()
}

/** The programs a pass needs, asked at once; whether all are compiled. */
function programsReady(
  programs: ReturnType<typeof capsulePrograms>,
  key: CapsuleProgramKey,
  output: CapsuleOutput | CapsuleSunOutput | undefined,
) {
  const drawn = !output
    ? []
    : isSunOutput(output)
      ? [programs.composeSun.ask()]
      : [programs.upsample({ targets: output.targets }).ask()]
  const wanted = [programs.shadow(key).stage.ask(), ...drawn]
  return wanted.every((pipeline) => pipeline.ready)
}

function runCamera(
  pass: Pass,
  scissor: readonly [number, number, number, number],
  light: CapsuleLight | undefined,
  distance: number,
  downsample: number,
  tiles: { tilesAcross: number; tilesDown: number },
) {
  const { image, settings, view, slot, device, data } = pass
  const { clipToView, viewToWorld } = capsuleCamera(image)
  writeCapsuleParams(paramFloats, {
    clipToView,
    viewToWorld,
    preViewTranslation: image.preViewTranslation,
    perspective: image.perspective,
    viewport: [0, 0, image.view[0], image.view[1]],
    scissor,
    downsample,
    maxOcclusionDistance: distance,
    shapeCount: data.count,
    tilesAcross: tiles.tilesAcross,
    tilesDown: tiles.tilesDown,
    fadeAngle: settings.capsuleShadowFadeAngleFromVertical,
    casterCount: data.casters?.length ?? 0,
    depth: capsuleDepthTerms(image),
    selfShadowIntensity: settings.capsuleIndirectSelfShadowingIntensity,
    ...(light && { light }),
  })
  device.queue.writeBuffer(view.params, slotOffsets(view, slot).params, paramFloats)
}

function dispatchShadow(
  pass: Pass,
  stage: GPUComputePipeline,
  groups: readonly GPUBindGroup[],
  grid: { tilesAcross: number; tilesDown: number },
  clear: boolean,
) {
  const { encoder, view } = pass
  if (clear) encoder.clearBuffer(view.tileCounts)
  const compute = encoder.beginComputePass(SHADOW_PASS)
  compute.setPipeline(stage)
  groups.forEach((group, at) => compute.setBindGroup(at, group))
  compute.dispatchWorkgroups(grid.tilesAcross, grid.tilesDown)
  compute.end()
}

/**
 * ONE LIGHT'S CAPSULE SHADOW (`encodeCapsuleDirectShadows`), after the light's shadow mask is drawn and before it is read: the shapes of the objects that
 * cast it, culled by tile and traced toward the light at a fraction of the image, then upsampled into `output` by the minimum
 * (`CAPSULE_BLENDS.attenuation`). Returns whether it was drawn; false where the settings are off, there is no shape, the programs are still
 * compiling or the budget refused the view.
 */
export function encodeCapsuleDirectShadows(
  state: CapsuleState,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  job: {
    image: CapsuleImage
    settings: CapsuleShadowSettings
    sources: CapsuleSources
    light: CapsuleLight
    data: CapsuleData
    output: CapsuleOutput | CapsuleSunOutput
    /** The light's rectangle in the image, first pixel and size; the whole view by default. */
    scissor?: readonly [number, number, number, number]
  },
) {
  const { image, settings, sources, light, data, output } = job
  if (!capsuleDirectOn(settings) || data.count === 0) return false
  const programs = capsulePrograms(device)
  const key: CapsuleProgramKey = {
    mode: light.directional ? 'directional' : 'point',
    casters: false,
  }
  if (!programsReady(programs, key, output)) return false
  const downsample = capsuleDownsample(settings.capsuleShadowsFullResolution)
  const view = ensureView(state, device, image, data, downsample, undefined)
  if (!view) return false
  const pass: Pass = {
    device,
    encoder,
    view,
    slot: state.slot,
    key,
    image,
    sources,
    data,
    settings,
  }
  const scissor = job.scissor ?? [0, 0, image.view[0], image.view[1]]
  const grid = capsuleGrid([scissor[2], scissor[3]], downsample, true)
  const program = programs.shadow(key)
  const stage = program.stage.get()
  if (!stage) return false
  state.slot++
  upload(pass)
  runCamera(pass, scissor, light, settings.capsuleMaxDirectOcclusionDistance, downsample, grid)
  dispatchShadow(pass, stage, shadowGroups(pass, program.layouts, false, undefined), grid, true)
  if (isSunOutput(output)) compose(pass, programs, output, grid, scissor)
  else
    upsample(
      pass,
      programs,
      output,
      grid,
      { scissor, viewport: [0, 0, image.view[0], image.view[1]] },
      true,
    )
  return true
}

/**
 * THE INDIRECT CAPSULE SHADOW (`encodeCapsuleIndirectShadows`): the shapes (and, over `sources.objects`, the meshes with a distance field)
 * of the objects that cast it, traced toward the direction of the place's light each carries, then multiplied into the scene's colour
 * and the ambient occlusion by `output` (`CAPSULE_BLENDS.modulate`). Where `data.derive` is set the directions are derived on the GPU first.
 */
export function encodeCapsuleIndirectShadows(
  state: CapsuleState,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  job: {
    image: CapsuleImage
    settings: CapsuleShadowSettings
    sources: CapsuleSources
    data: CapsuleData
    output: CapsuleOutput
  },
) {
  const { image, settings, sources, data, output } = job
  const casters = !!data.casters?.length && !!sources.objects && sources.objects.count > 0
  if (!capsuleIndirectOn(settings) || (data.count === 0 && !casters) || !data.records) return false
  if (data.derive && !sources.sky) return false
  const programs = capsulePrograms(device)
  const key: CapsuleProgramKey = { mode: 'indirect', casters }
  if (
    !programsReady(programs, key, output) ||
    (data.derive && !programs.directions(!!sources.lightmap).ask().ready)
  )
    return false
  const downsample = capsuleDownsample(settings.capsuleShadowsFullResolution)
  const view = ensureView(state, device, image, data, downsample, undefined)
  if (!view) return false
  const pass: Pass = {
    device,
    encoder,
    view,
    slot: state.slot,
    key,
    image,
    sources,
    data,
    settings,
  }
  const program = programs.shadow(key)
  const stage = program.stage.get()
  if (!stage) return false
  const scissor = [0, 0, image.view[0], image.view[1]] as const
  const grid = capsuleGrid([scissor[2], scissor[3]], downsample, false)
  if (grid.tilesAcross === 0 || grid.tilesDown === 0) return false
  state.slot++
  upload(pass)
  const derived = deriveDirections(pass, programs)
  if (data.derive && !derived) return false
  runCamera(
    pass,
    scissor,
    undefined,
    settings.capsuleMaxIndirectOcclusionDistance,
    downsample,
    grid,
  )
  dispatchShadow(pass, stage, shadowGroups(pass, program.layouts, derived, undefined), grid, true)
  upsample(pass, programs, output, grid, { scissor, viewport: scissor }, false)
  return true
}

/**
 * THE CAPSULE SHADOW OF THE MOVABLE SKY LIGHT (`encodeCapsuleSkyShadows`), applied to the bent normal the ambient occlusion computed: the shapes
 * darken `receiver` (a `rgba16float` texture of `size` pixels, `downsample` times smaller than the image) and the result is written to a texture
 * the view holds, returned for the occlusion's pipeline to continue with. None where nothing was drawn: the pipeline keeps `receiver`.
 */
export function encodeCapsuleSkyShadows(
  state: CapsuleState,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  job: {
    image: CapsuleImage
    settings: CapsuleShadowSettings
    sources: CapsuleSources
    data: CapsuleData
    receiver: GPUTextureView
    size: readonly [number, number]
    downsample: number
  },
) {
  const { image, settings, sources, data, receiver, size, downsample } = job
  if (!capsuleIndirectOn(settings) || data.count === 0 || !data.records) return undefined
  if (data.derive && !sources.sky) return undefined
  const programs = capsulePrograms(device)
  const key: CapsuleProgramKey = { mode: 'skylight', casters: false }
  if (
    !programsReady(programs, key, undefined) ||
    (data.derive && !programs.directions(!!sources.lightmap).ask().ready)
  )
    return undefined
  const view = ensureView(
    state,
    device,
    image,
    data,
    capsuleDownsample(settings.capsuleShadowsFullResolution),
    size,
  )
  if (!view?.bent) return undefined
  const pass: Pass = {
    device,
    encoder,
    view,
    slot: state.slot,
    key,
    image,
    sources,
    data,
    settings,
  }
  const program = programs.shadow(key)
  const stage = program.stage.get()
  if (!stage) return undefined
  const scissor = [0, 0, image.view[0], image.view[1]] as const
  const grid = capsuleGrid([scissor[2], scissor[3]], downsample, false)
  state.slot++
  upload(pass)
  const derived = deriveDirections(pass, programs)
  if (data.derive && !derived) return undefined
  runCamera(
    pass,
    scissor,
    undefined,
    settings.capsuleMaxIndirectOcclusionDistance,
    downsample,
    grid,
  )
  dispatchShadow(pass, stage, shadowGroups(pass, program.layouts, derived, receiver), grid, false)
  return view.bent.view
}
