import { NEVER_SEEN } from '../../frame/backend/state/previousCamera.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { standInBuffer, standInTexture } from '../../gpu/core/standIns.ts'
import { DEPTH_FORMAT } from '../../scene/targetFormats.ts'
import {
  readSingleLayerWaterSetting,
  SINGLE_LAYER_WATER_RULES,
  type SingleLayerWaterValues,
} from '../../../../sdk-core/src/contracts/singleLayerWaterOptions.ts'
import { settingsWatch } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { viewProj } from '../../frame/backend/helpers.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  WATER_AT,
  WATER_BINDINGS,
  WATER_COPY_BINDINGS as C,
  WATER_MASK_BINDINGS as M,
  WATER_NORMALS_FORMAT,
  WATER_PARAMS_WORDS,
  WATER_REFLECTION_CODE,
  WATER_TILE_BINDINGS as T,
  WATER_TILE_PIXELS,
} from './waterLayout.ts'
import { waterGroupLayout } from './waterPipelines.ts'
import { waterScenePipelines } from './waterSceneStages.ts'
import { waterTextures, waterTileBuffers, waterViews } from './waterTargetResources.ts'

/** The guard band, in texels of the copy, the safe range of texture coordinates leaves at the view's
 *  edge so that a gather never reads past it: a little over half a texel. */
const GUARD_BAND = 0.55
/** The least fade range of a culling: a smoothstep needs two ends. */
const LEAST_FADE = 0.01

/** The settings the water reads each image, as a snapshot: read into one object, which says whether any moved. */
export type WaterSettings = SingleLayerWaterValues

/**
 * THE WATER PASS'S TARGETS, made at the size of the render targets: the copy of the scene without the
 * water at `1 / factor` of it (its colour, and its depth as the clip w), the depth the water is drawn
 * into before it is shaded (a copy of the scene's, written over where the water is nearest), the
 * mask of the refraction, the water's surface (its normal and roughness, its reflectance and its flag),
 * the separated sun where the programs keep it apart, the tiles that hold water (a bit a tile, the
 * list, the indirect draw's arguments), the uniform and the groups that name them. Remade when the size
 * or the factor changes, the old ones retired after the image. A pass binds a texture it draws into
 * to a stand-in (`standIns`), not to itself.
 */
export interface WaterTargets {
  width: number
  height: number
  factor: number
  tilesAcross: number
  tilesDown: number
  sceneColor: GPUTexture
  sceneDepth: GPUTexture
  waterDepth: GPUTexture
  mask: GPUTexture
  normals: GPUTexture
  specular: GPUTexture
  sun: GPUTexture | undefined
  views: {
    sceneColor: GPUTextureView
    sceneDepth: GPUTextureView
    waterDepth: GPUTextureView
    mask: GPUTextureView
    normals: GPUTextureView
    specular: GPUTextureView
    sun: GPUTextureView | undefined
  }
  tileMask: GPUBuffer
  tileList: GPUBuffer
  tileArgs: GPUBuffer
  params: GPUBuffer
  paramWords: Float32Array<ArrayBuffer>
  paramInts: Uint32Array<ArrayBuffer>
  /** The image (`WebgpuRun.frame`) the water's depth was drawn ahead of the lights for, or 0 (`encodeWaterDepth` notes it). */
  depthAheadFor: number
  /** Whether the words the settings give the uniform were written, and for which separation. */
  written: boolean
  separate: boolean
  masked: boolean
  /** The settings this image reads, and whether any moved. */
  watch: ReturnType<typeof settingsWatch<typeof SINGLE_LAYER_WATER_RULES>>
  /** The group of the shading, and of the composite on the sun's distance-field mask it was made for. */
  shadeGroup: GPUBindGroup
  composite?: { mask: GPUBuffer | undefined; group: GPUBindGroup }
  /** The groups of the copy, the mask, the tiles' kernels and the identifiers' kernel, made on the views of the scene's
   *  colour and depth they read (and again when those move). */
  scene?: {
    hdr: GPUTextureView
    depth: GPUTextureView
    copy: GPUBindGroup
    mask: GPUBindGroup
    kernels: GPUBindGroup
    ids?: { view: GPUTextureView; group: GPUBindGroup }
  }
}

/** The one-texel resources a pass binds in place of the target it draws into, one set a device. */
const standIns = oncePerDevice((device) => ({
  colour: standInTexture(device, 'Trillion3D water stand-in', WATER_NORMALS_FORMAT).createView(),
  depth: standInTexture(device, 'Trillion3D water stand-in depth', DEPTH_FORMAT).createView(),
  // Read as no mask: a word that says its row length is zero (`waterFarFactor`).
  mask: standInBuffer(device, 'Trillion3D water stand-in mask', 16, GPUBufferUsage.STORAGE),
}))

function createTargets(
  device: GPUDevice,
  width: number,
  height: number,
  factor: number,
  depth: { width: number; height: number },
  separate: boolean,
) {
  const textures = waterTextures(device, width, height, factor, depth, separate)
  const tilesAcross = ceilDiv(width, WATER_TILE_PIXELS),
    tilesDown = ceilDiv(height, WATER_TILE_PIXELS)
  const { tileMask, tileList, tileArgs } = waterTileBuffers(device, tilesAcross, tilesDown)
  const params = device.createBuffer({
    label: 'Trillion3D water view',
    size: WATER_PARAMS_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const paramWords = new Float32Array(WATER_PARAMS_WORDS)
  const views = waterViews(textures)
  const targets = {
    width,
    height,
    factor,
    tilesAcross,
    tilesDown,
    ...textures,
    views,
    tileMask,
    tileList,
    tileArgs,
    params,
    paramWords,
    paramInts: new Uint32Array(paramWords.buffer),
    depthAheadFor: NEVER_SEEN,
    written: false,
    separate: false,
    masked: false,
    watch: settingsWatch(SINGLE_LAYER_WATER_RULES),
  } as WaterTargets
  targets.shadeGroup = waterGroup(device, targets, false, undefined)
  return targets
}

/** The water group (`WATER_GROUP`) of `targets`: of the shading, whose targets it names by stand-ins, or of the
 *  composite, which reads the water's surface and the separated sun, and the sun's distance-field `mask`. */
function waterGroup(
  device: GPUDevice,
  targets: WaterTargets,
  surface: boolean,
  mask: GPUBuffer | undefined,
) {
  const stand = standIns(device),
    { views } = targets
  return device.createBindGroup({
    label: 'Trillion3D water',
    layout: waterGroupLayout(device),
    entries: [
      { binding: WATER_BINDINGS.params, resource: { buffer: targets.params } },
      { binding: WATER_BINDINGS.color, resource: views.sceneColor },
      { binding: WATER_BINDINGS.depth, resource: views.sceneDepth },
      { binding: WATER_BINDINGS.mask, resource: views.mask },
      { binding: WATER_BINDINGS.point, resource: postSamplers(device).point },
      { binding: WATER_BINDINGS.normals, resource: surface ? views.normals : stand.colour },
      { binding: WATER_BINDINGS.specular, resource: surface ? views.specular : stand.colour },
      { binding: WATER_BINDINGS.waterDepth, resource: surface ? views.waterDepth : stand.depth },
      { binding: WATER_BINDINGS.tiles, resource: { buffer: targets.tileList } },
      { binding: WATER_BINDINGS.sun, resource: (surface && views.sun) || stand.colour },
      { binding: WATER_BINDINGS.farMask, resource: { buffer: (surface && mask) || stand.mask } },
    ],
  })
}

/** The group of the composite, made again where the sun's distance-field `mask` moved. */
export function waterCompositeGroup(
  device: GPUDevice,
  targets: WaterTargets,
  mask: GPUBuffer | undefined,
) {
  const held = targets.composite
  if (held && held.mask === mask) return held.group
  const group = waterGroup(device, targets, true, mask)
  targets.composite = { mask, group }
  return group
}

/** `free` of every texture and buffer of `targets`. */
const freeTargets = (targets: WaterTargets, free: (resource: { destroy(): void }) => void) => {
  const { sceneColor, sceneDepth, waterDepth, mask, normals, specular, sun } = targets
  for (const resource of [sceneColor, sceneDepth, waterDepth, mask, normals, specular])
    free(resource)
  if (sun) free(sun)
  for (const resource of [targets.tileMask, targets.tileList, targets.tileArgs, targets.params])
    free(resource)
}

/** Gives the water's targets back, at dispose. */
export function disposeWaterTargets(blendState: { waterTargets: WaterTargets | undefined }) {
  if (blendState.waterTargets)
    freeTargets(blendState.waterTargets, (resource) => resource.destroy())
  blendState.waterTargets = undefined
}

/** Whether the image draws single-layer water as far as the scene and the settings go: the plan holds a
 *  water item and `singleLayerWater` is on. */
export const waterWanted = (rt: WebgpuPagesRuntime) =>
  rt.blendState.water && readSingleLayerWaterSetting(rt, 'singleLayerWater')

/** Whether the water's depth is drawn ahead of the lights: the water is drawn (`waterWanted`) with its
 *  depth pass (`singleLayerWaterDepthPrepass`). */
export const waterDepthPrepassWanted = (rt: WebgpuPagesRuntime) =>
  waterWanted(rt) && readSingleLayerWaterSetting(rt, 'singleLayerWaterDepthPrepass')

/** Whether the programs keep the sun apart from the rest of the water's light: either project switch that
 *  asks for the separated term (`singleLayerWaterShadersSupportDistanceFieldShadow`,
 *  `singleLayerWaterShadersSupportVsmFiltering`), read when the session opens. */
export const waterSeparates = (rt: {
  context: Parameters<typeof readSingleLayerWaterSetting>[0]['context']
}) =>
  readSingleLayerWaterSetting(rt, 'singleLayerWaterShadersSupportDistanceFieldShadow') ||
  readSingleLayerWaterSetting(rt, 'singleLayerWaterShadersSupportVsmFiltering')

/** The water targets of the image at the render size, made or remade for the setting's factor
 *  (`singleLayerWaterRefractionDownsample`). */
export function waterTargetsOf(rt: WebgpuPagesRuntime, device: GPUDevice): WaterTargets {
  const [width, height] = rt.gpu.targetSize,
    factor = readSingleLayerWaterSetting(rt, 'singleLayerWaterRefractionDownsample')
  const { depthTexture } = rt.gpu
  const held = rt.blendState.waterTargets
  if (
    held &&
    held.width === width &&
    held.height === height &&
    held.factor === factor &&
    held.waterDepth.width === depthTexture!.width
  )
    return held
  if (held) freeTargets(held, (resource) => retire(device, resource))
  const depth = { width: depthTexture!.width, height: depthTexture!.height }
  return (rt.blendState.waterTargets = createTargets(
    device,
    width,
    height,
    factor,
    depth,
    waterSeparates(rt),
  ))
}

/** The scene's depth with the water drawn into it, where the water's depth pass was drawn ahead of this
 *  image's lights, so that the sun's page marking reads it (`vsmPixelPageMarkingWgsl` `water`). Targets
 *  remade since hold none. */
export function waterDepthMarked(rt: WebgpuPagesRuntime) {
  const targets = rt.blendState.waterTargets
  return targets?.depthAheadFor === rt.run.frame ? targets.views.waterDepth : undefined
}

/** The groups of the copy, the mask and the tiles' kernels, made on the views of the scene's colour and
 *  depth they read (and remade when those are). */
export function waterSceneGroups(
  device: GPUDevice,
  targets: WaterTargets,
  hdr: GPUTextureView,
  depth: GPUTextureView,
) {
  if (targets.scene?.hdr === hdr && targets.scene.depth === depth) return targets.scene
  const { color, mask, kernelLayout } = waterScenePipelines(device)
  const uniform = (binding: number) => ({ binding, resource: { buffer: targets.params } })
  const storage = (binding: number, buffer: GPUBuffer) => ({ binding, resource: { buffer } })
  return (targets.scene = {
    hdr,
    depth,
    copy: device.createBindGroup({
      layout: color.layout,
      entries: [
        uniform(C.params),
        { binding: C.color, resource: hdr },
        { binding: C.depth, resource: depth },
        { binding: C.sampler, resource: postSamplers(device).clamped },
        storage(C.tiles, targets.tileList),
      ],
    }),
    mask: device.createBindGroup({
      layout: mask.layout,
      entries: [
        uniform(M.params),
        { binding: M.waterDepth, resource: targets.views.waterDepth },
        { binding: M.opaqueDepth, resource: depth },
        { binding: M.sceneLinear, resource: targets.views.sceneDepth },
      ],
    }),
    kernels: device.createBindGroup({
      layout: kernelLayout,
      entries: [
        uniform(T.params),
        { binding: T.waterDepth, resource: targets.views.waterDepth },
        { binding: T.opaqueDepth, resource: depth },
        storage(T.mask, targets.tileMask),
        storage(T.list, targets.tileList),
        storage(T.args, targets.tileArgs),
      ],
    }),
  })
}

/** The group of the kernel that clears the identifiers of the pixels the water covers, on the visibility
 *  target `ids` (made again when that is). */
export function waterIdsGroup(
  device: GPUDevice,
  targets: WaterTargets,
  depth: GPUTextureView,
  ids: GPUTextureView,
) {
  const scene = targets.scene!
  if (scene.ids?.view === ids) return scene.ids.group
  const group = device.createBindGroup({
    layout: waterScenePipelines(device).idsLayout,
    entries: [
      { binding: T.params, resource: { buffer: targets.params } },
      { binding: T.waterDepth, resource: targets.views.waterDepth },
      { binding: T.opaqueDepth, resource: depth },
      { binding: T.ids, resource: ids },
    ],
  })
  scene.ids = { view: ids, group }
  return group
}

const invertTo = new Float64Array(16)
/** Writes a culling's range at word `at`: its two ends and whether it is on. */
function putRange(words: Float32Array, at: number, begin: number, end: number, on: boolean) {
  words[at] = begin
  words[at + 1] = end
  words[at + 2] = on ? 1 : 0
}

/** The words the settings give the uniform, written when they moved (`watch`): the reflection technique, the
 *  mask, the clouds' shade, the copy's factor, the cullings' ranges and the sun's switches. Returns
 *  whether the refraction mask is made. */
function putSettings(targets: WaterTargets, v: WaterSettings, separate: boolean) {
  const { paramWords: words, paramInts: ints } = targets
  const fade = (value: number) => Math.max(value, LEAST_FADE)
  const culling = v.singleLayerWaterRefractionCulling
  const distance = v.singleLayerWaterRefractionDistanceCulling,
    fresnel = v.singleLayerWaterRefractionFresnelCulling,
    depth = v.singleLayerWaterRefractionDepthCulling
  putRange(
    words,
    WATER_AT.distanceRange,
    distance - fade(v.singleLayerWaterRefractionDistanceCullingFadeRange),
    distance,
    culling && distance > 0,
  )
  putRange(
    words,
    WATER_AT.fresnelRange,
    fresnel,
    fresnel + fade(v.singleLayerWaterRefractionFresnelCullingFadeRange),
    culling && fresnel > 0,
  )
  putRange(
    words,
    WATER_AT.depthRange,
    depth - fade(v.singleLayerWaterRefractionDepthCullingFadeRange),
    depth,
    culling && depth > 0,
  )
  const masked = culling && (distance > 0 || fresnel > 0 || depth > 0)
  ints[WATER_AT.modes] = WATER_REFLECTION_CODE[v.singleLayerWaterReflection]
  ints[WATER_AT.modes + 1] = masked ? 1 : 0
  ints[WATER_AT.modes + 2] = v.singleLayerWaterCloudShadow ? 1 : 0
  ints[WATER_AT.modes + 3] = targets.factor
  ints[WATER_AT.filters] =
    v.singleLayerWaterShadersSupportVsmFiltering && v.singleLayerWaterVsmFiltering ? 1 : 0
  ints[WATER_AT.filters + 1] = separate ? 1 : 0
  return masked
}

/** Whether the water keeps its sun apart this image (the separated sun): the programs hold the term and the
 *  distance-field shadow (support, switch, and a scene whose meshes have fields) or the filtering is on. */
export const waterSeparated = (v: WaterSettings, distanceFields: boolean) =>
  (v.singleLayerWaterShadersSupportDistanceFieldShadow &&
    v.singleLayerWaterDistanceFieldShadow &&
    distanceFields) ||
  (v.singleLayerWaterShadersSupportVsmFiltering && v.singleLayerWaterVsmFiltering)

/** Writes the water's view uniform for this image (`WaterParams`): the inverse of the render matrix and
 *  its last row, the eye, the copy's size and safe range and the tiles' counts, each image, and the words the
 *  settings give it when they moved. Returns whether the refraction mask is made this image. */
export function writeWaterParams(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  targets: WaterTargets,
  v: WaterSettings,
  separate: boolean,
) {
  const { paramWords: words, paramInts: ints } = targets
  words.set(invertMatrix4(invertTo, viewProj), WATER_AT.inverseViewProjection)
  for (let i = 0; i < 4; i++) words[WATER_AT.clipW + i] = viewProj[i * 4 + 3]
  const eye = rt.run.gate.cam.eye
  words[WATER_AT.eye] = eye[0]
  words[WATER_AT.eye + 1] = eye[1]
  words[WATER_AT.eye + 2] = eye[2]
  const copyWidth = ceilDiv(targets.width, targets.factor),
    copyHeight = ceilDiv(targets.height, targets.factor)
  words[WATER_AT.scene] = copyWidth
  words[WATER_AT.scene + 1] = copyHeight
  words[WATER_AT.scene + 2] = 1 / copyWidth
  words[WATER_AT.scene + 3] = 1 / copyHeight
  words[WATER_AT.bounds] = GUARD_BAND / copyWidth
  words[WATER_AT.bounds + 1] = GUARD_BAND / copyHeight
  words[WATER_AT.bounds + 2] = 1 - GUARD_BAND / copyWidth
  words[WATER_AT.bounds + 3] = 1 - GUARD_BAND / copyHeight
  ints[WATER_AT.tiles] = targets.tilesAcross
  ints[WATER_AT.tiles + 1] = targets.tilesDown
  ints[WATER_AT.tiles + 2] = targets.width
  ints[WATER_AT.tiles + 3] = targets.height
  // The settings' words are written once, then when a setting or the separation moved.
  if (targets.watch.moved || !targets.written || targets.separate !== separate) {
    targets.masked = putSettings(targets, v, separate)
    targets.written = true
    targets.separate = separate
  }
  device.queue.writeBuffer(targets.params, 0, words)
  return targets.masked
}
