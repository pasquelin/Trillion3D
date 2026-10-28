import {
  CAPSULE_SHADOW_VIEW_RULES,
  capsuleIndirectOn,
  type CapsuleShadowSettings,
} from '../../../../sdk-core/src/contracts/capsuleShadowOptions.ts'
import { resolveSettingsInto } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { Skeleton } from '../../../../sdk-core/src/world/animation/skeleton.ts'
import {
  holdsOffsetSwitches,
  offsetSwitchesOf,
  offsetSwitchEdits,
} from '../../../../sdk-core/src/world/object/offsetSwitches.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { rootSource } from '../../placement/hidden.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { describeImage } from '../../frame/backend/helpers.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { FLAGS_VIEW } from '../../materials/surface/surfaceOutputs.ts'
import { skyLightReadOf } from '../../frame/render/skyLightState.ts'
import { volumetricLightmapOf } from '../volumetricLightmap/frame.ts'
import type { VsmProjectionLight } from '../shadows/vsm/projection/projectionPass.ts'
import { PER_LIGHT_MASK_FORMAT } from '../shadows/vsm/projection/maskFormat.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { shadowsOn } from '../shadows/vsm/frame/vsmGates.ts'
import {
  CAPSULE_BLENDS,
  beginCapsuleImage,
  createCapsuleState,
  encodeCapsuleDirectShadows,
  encodeCapsuleIndirectShadows,
  encodeCapsuleSkyShadows,
  type CapsuleData,
  type CapsuleImage,
  type CapsuleSources,
  type CapsuleState,
} from './frame.ts'
import type { CapsuleLight } from './plan.ts'
import { restBodiesOf, writeObjectShapes, type CapsuleObject } from './gather.ts'
import { capsuleDirectOn } from '../../../../sdk-core/src/contracts/capsuleShadowOptions.ts'
import {
  CAPSULE_SHAPE_FLOATS,
  LIGHT_DIRECTION_WORDS,
  minVisibilityOf,
  writeLightDirection,
} from './shapes.ts'

/**
 * THE CAPSULE SHADOWS OF A SESSION'S FRAME: the objects whose nodes cast them (`capsuleObjectsOf`, read from the cut's roots once for as long as
 * the roots and the nodes' switches stand), the settings, the image and the frame's sources, and the movable sky light's pass over the bent
 * normals the occlusion computed (`capsuleSkyShadows`). A scene with no such object costs a compare and holds nothing.
 */

interface Held {
  state: CapsuleState
  /** The frame the state's slots were last counted from the first of (`beginImage`). */
  frame: number
  scanned: { roots: unknown; length: number; switches: number } | undefined
  objects: CapsuleObject[]
  shapes: Float32Array
  records: Uint32Array
  casterIndices: Uint32Array
  recordFloats: Float32Array
  /** The skeleton and body list the rest bodies were made for, by node. */
  /** The layers of the local lights' capsule shadow the one-pass projection reads (`capsuleLocalLayers`). */
  layers:
    { texture: GPUTexture; array: GPUTextureView; each: GPUTextureView[]; size: string } | undefined
  bodies: WeakMap<
    Object3D,
    { list: unknown; skeleton: Skeleton | undefined; made: ReturnType<typeof restBodiesOf> }
  >
}

const held = new WeakMap<object, Held>()
const settings = {} as CapsuleShadowSettings
const image: { -readonly [K in keyof CapsuleImage]: CapsuleImage[K] } = {
  view: [0, 0],
  extent: [0, 0],
  projection: [],
  world: [],
  perspective: true,
  near: 0,
  far: 0,
  preViewTranslation: [0, 0, 0],
}

/** Counts the slots of the image from the first: once a frame, whichever pass asks first (the passes of one image take different slots). */
function beginImage(rt: WebgpuPagesRuntime, h: Held) {
  if (h.frame === rt.run.frame) return
  h.frame = rt.run.frame
  beginCapsuleImage(h.state)
}

function heldOf(rt: WebgpuPagesRuntime): Held {
  let h = held.get(rt)
  if (!h)
    held.set(
      rt,
      (h = {
        state: createCapsuleState(),
        frame: -1,
        scanned: undefined,
        objects: [],
        shapes: new Float32Array(0),
        records: new Uint32Array(0),
        casterIndices: new Uint32Array(0),
        recordFloats: new Float32Array(0),
        layers: undefined,
        bodies: new WeakMap(),
      }),
    )
  return h
}

/** The objects of the cut whose nodes cast a capsule shadow, read again when the roots or any node's switches moved. */
function capsuleObjectsOf(rt: WebgpuPagesRuntime): readonly CapsuleObject[] {
  const h = heldOf(rt)
  const roots = rt.layout.selectionRoots
  const switches = offsetSwitchEdits()
  const last = h.scanned
  if (last && last.roots === roots && last.length === roots.length && last.switches === switches)
    return h.objects
  h.scanned = { roots, length: roots.length, switches }
  h.objects = []
  for (const root of roots) {
    const node = rootSource(root)
    if (!node || !holdsOffsetSwitches(node)) continue
    const s = offsetSwitchesOf(node)
    // An object that casts an indirect shadow needs no capsule when its mesh has a distance field (`capsuleIndirectFactors`).
    if (!(s.castCapsuleDirectShadow && s.shadowCapsules.length) && !s.castCapsuleIndirectShadow)
      continue
    const skeleton = (node as { skeleton?: Skeleton }).skeleton
    let rest = h.bodies.get(node)
    if (!rest || rest.list !== s.shadowCapsules || rest.skeleton !== skeleton)
      h.bodies.set(
        node,
        (rest = {
          list: s.shadowCapsules,
          skeleton,
          made: restBodiesOf(s.shadowCapsules, skeleton),
        }),
      )
    h.objects.push({
      bodies: rest.made,
      skeleton,
      world: node.matrixWorld.elements as Float64Array,
      node,
      direct: s.castCapsuleDirectShadow,
      indirect: s.castCapsuleIndirectShadow,
      minVisibility: s.capsuleIndirectShadowMinVisibility,
    })
  }
  return h.objects
}

/** The view's capsule shadow settings, read for the image. */
const capsuleSettingsOf = (rt: WebgpuPagesRuntime) =>
  resolveSettingsInto(CAPSULE_SHADOW_VIEW_RULES, rt.context, settings)

function describe(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  describeImage(image, rt, cam)
  return image
}

/** The frame's sources of the capsule passes, or none while the frame lacks the depth or the flags. */
function sourcesOf(rt: WebgpuPagesRuntime, planning = false): CapsuleSources | undefined {
  const depth = rt.vis.gpuHiz?.depth()
  const flags = rt.gpu.surfaces?.views()[FLAGS_VIEW]
  if (!rt.gpu.device || !depth || !flags || (!planning && !rt.run.depthDrawn) || !shadowsOn(rt))
    return undefined
  // The lightmap is streamed by the image's own reads; planning only asks whether the frame can draw.
  return {
    depth,
    flags,
    sky: planning ? undefined : skyLightReadOf(rt),
    lightmap: planning ? undefined : volumetricLightmapOf(rt, rt.gpu.device),
  }
}

/** What the sky light is, for the light directions (`skyLightMode`): a movable one captures the scene as it is drawn, a stationary one has static shadowing. */
function skyKindOf(rt: WebgpuPagesRuntime) {
  const mobility = rt.distanceFields?.skyLight?.light.mobility
  return mobility
    ? { wantsStaticShadowing: mobility === 'stationary', realTimeCapture: mobility === 'movable' }
    : undefined
}

/** The indirect data of the objects that cast it: their shapes, and for each a light record, the object's position, from which the GPU derives the direction. */
function indirectData(
  h: Held,
  objects: readonly CapsuleObject[],
  skyKind: NonNullable<CapsuleData['derive']>['sky'],
  fields: readonly { readonly index: number; readonly owner: CapsuleObject }[] = [],
): CapsuleData | undefined {
  const owners = objects.filter((o) => o.indirect && o.bodies.length)
  const room = owners.reduce((sum, o) => sum + o.bodies.length, 0)
  if (!room && !fields.length) return undefined
  if (h.shapes.length < room * CAPSULE_SHAPE_FLOATS)
    h.shapes = new Float32Array(room * CAPSULE_SHAPE_FLOATS)
  const records = room + fields.length
  if (h.records.length < records * LIGHT_DIRECTION_WORDS) {
    h.records = new Uint32Array(records * LIGHT_DIRECTION_WORDS)
    h.recordFloats = new Float32Array(h.records.buffer)
  }
  /** The record of an object: its position, which the GPU turns into the direction and the angle (`lightDirectionWgsl.ts`). */
  const record = (at: number, owner: CapsuleObject) =>
    writeLightDirection(
      h.recordFloats,
      h.records,
      at * LIGHT_DIRECTION_WORDS,
      [owner.world[12], owner.world[13], owner.world[14]],
      0,
      minVisibilityOf(owner.minVisibility),
    )
  const ranges: number[] = []
  const count = writeObjectShapes(h.shapes, owners, () => true, [0, 0, 0], ranges)
  for (let k = 0, at = 0; k < ranges.length; k += 2)
    for (let shape = ranges[k]; shape < ranges[k + 1]; shape++, at++) record(at, owners[k / 2])
  // The light records of the distance-field casters follow those of the capsules (the pass reads them there).
  fields.forEach((field, k) => record(count + k, field.owner))
  if (h.casterIndices.length < fields.length) h.casterIndices = new Uint32Array(fields.length)
  fields.forEach((field, k) => (h.casterIndices[k] = field.index))
  return {
    shapes: h.shapes,
    count,
    records: h.records.subarray(0, records * LIGHT_DIRECTION_WORDS),
    ...(fields.length && { casters: h.casterIndices.subarray(0, fields.length) }),
    derive: { sky: skyKind },
  }
}

/**
 * THE MOVABLE SKY LIGHT'S CAPSULE SHADOW, as the callback the occlusion takes (`DfaoInputs.skyShadows`): the bent normals it computed are darkened
 * by the shapes of the objects that cast an indirect shadow, the result the lit pass reads. None where the settings are off or no object casts.
 */
export function capsuleSkyShadows(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const objects = capsuleObjectsOf(rt)
  if (!objects.length) return undefined
  const options = capsuleSettingsOf(rt)
  const sources = sourcesOf(rt)
  if (!capsuleIndirectOn(options) || !sources) return undefined
  const h = heldOf(rt)
  const data = indirectData(h, objects, skyKindOf(rt))
  if (!data) return undefined
  const device = rt.gpu.device!
  const frame = describe(rt, cam)
  return (encoder: GPUCommandEncoder, bent: GPUTextureView, size: readonly [number, number]) => {
    beginImage(rt, h)
    return encodeCapsuleSkyShadows(h.state, device, encoder, {
      image: frame,
      settings: options,
      sources,
      data,
      receiver: bent,
      size,
      downsample: Math.max(1, Math.round(frame.extent[0] / size[0])),
    })
  }
}

const layerTarget: GPURenderPassColorAttachment = {
  view: undefined as never,
  loadOp: 'load',
  storeOp: 'store',
}
const maskTargets: GPUColorTargetState[] = [
  { format: PER_LIGHT_MASK_FORMAT, blend: CAPSULE_BLENDS.attenuation },
]
const maskOutput = { targets: maskTargets, attachments: [layerTarget] }

/** What a light's pass is given: the frame's objects that cast a direct shadow, read once for the image. */
interface DirectFrame {
  readonly h: Held
  readonly objects: readonly CapsuleObject[]
  readonly options: CapsuleShadowSettings
  readonly sources: CapsuleSources
  readonly device: GPUDevice
  readonly image: CapsuleImage
}

/** The frame of the direct passes, or none where the settings are off or no object casts a direct shadow: then no pass and no resource. */
function directFrame(rt: WebgpuPagesRuntime, cam: EngineCamera): DirectFrame | undefined {
  const objects = capsuleObjectsOf(rt).filter((o) => o.direct && o.bodies.length)
  if (!objects.length) return undefined
  const options = capsuleSettingsOf(rt)
  const sources = sourcesOf(rt)
  if (!capsuleDirectOn(options) || !sources) return undefined
  const h = heldOf(rt)
  beginImage(rt, h)
  return { h, objects, options, sources, device: rt.gpu.device!, image: describe(rt, cam) }
}

/** The shapes of the objects within `reach` metres of `at` (all of them for a reach of infinity) in the frame's shape buffer; how many. */
function shapesWithin(frame: DirectFrame, at: ArrayLike<number> | undefined, reach: number) {
  const near = at
    ? frame.objects.filter(
        (o) => Math.hypot(o.world[12] - at[0], o.world[13] - at[1], o.world[14] - at[2]) < reach,
      )
    : frame.objects
  const room = near.reduce((sum, o) => sum + o.bodies.length, 0) * CAPSULE_SHAPE_FLOATS
  if (frame.h.shapes.length < room) frame.h.shapes = new Float32Array(room)
  return near.length ? writeObjectShapes(frame.h.shapes, near, () => true, [0, 0, 0], []) : 0
}

/**
 * THE CAPSULE SHADOWS OF THE LOCAL LIGHTS on the per-light path, as the callback the light's projection takes (`PerLightInputs.afterMask`): once a
 * light's layer of the mask is projected, the shapes of the objects that cast a direct shadow within its reach are traced toward it and the
 * result is taken into the layer by the minimum over the pixels the light reaches. None where the settings are off or no object casts one.
 */
export function capsuleLightMask(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const frame = directFrame(rt, cam)
  if (!frame) return undefined
  return (
    encoder: GPUCommandEncoder,
    light: VsmProjectionLight,
    layer: GPUTextureView,
    rect: readonly [number, number, number, number],
  ) => {
    if (light.type === 'directional') return
    const count = shapesWithin(
      frame,
      light.position,
      light.radius + frame.options.capsuleMaxDirectOcclusionDistance,
    )
    if (!count) return
    layerTarget.view = layer
    encodeCapsuleDirectShadows(frame.h.state, frame.device, encoder, {
      image: frame.image,
      settings: frame.options,
      sources: frame.sources,
      light: localLight(light),
      data: { shapes: frame.h.shapes, count },
      output: maskOutput,
      scissor: [rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]],
    })
  }
}

/** A local light as the capsule pass reads it: its source radius is the light's own (0 where it has none: a point source takes the pass's default). */
const localLight = (light: Exclude<VsmProjectionLight, { type: 'directional' }>): CapsuleLight => ({
  directional: false,
  position: [light.position[0], light.position[1], light.position[2]],
  direction: [0, 0, 1],
  invRadius: 1 / light.radius,
  sourceRadius: light.sourceRadius ?? 0,
  sourceAngle: 0,
})

/**
 * THE CAPSULE SHADOWS OF THE SUNS, taken into the layers of the suns' mask once their projection is encoded: for each sun, every shape that casts a
 * direct shadow traced toward it, and the minimum of the layer's visibility and the shadow written back (`CapsuleSunOutput`). A sun's `sourceRadius`
 * is the sine of its angular radius; the pass reads the angle subtended, in degrees. Nothing is encoded where the settings are off or no object casts.
 */
export function encodeCapsuleSunMasks(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  encoder: GPUCommandEncoder,
  lights: readonly VsmProjectionLight[],
  suns: number,
  sunMask: GPUTextureView,
) {
  const frame = directFrame(rt, cam)
  if (!frame) return
  const count = shapesWithin(frame, undefined, Infinity)
  if (!count) return
  for (let layer = 0; layer < suns; layer++) {
    const sun = lights[layer]
    encodeCapsuleDirectShadows(frame.h.state, frame.device, encoder, {
      image: frame.image,
      settings: frame.options,
      sources: frame.sources,
      light: {
        directional: true,
        position: [0, 0, 0],
        direction: [-sun.direction[0], -sun.direction[1], -sun.direction[2]],
        invRadius: 0,
        sourceRadius: 0,
        sourceAngle:
          (2 * Math.asin(Math.min(Math.max(sun.sourceRadius ?? 0, 0), 1)) * 180) / Math.PI,
      },
      data: { shapes: frame.h.shapes, count },
      output: { sunMask, layer },
    })
  }
}

/** Whether any object casts a direct capsule shadow this image: the suns' mask and the lights' cannot then be held from the last projection. */
export const capsuleCastsDirect = (rt: WebgpuPagesRuntime) =>
  capsuleDirectOn(capsuleSettingsOf(rt)) &&
  capsuleObjectsOf(rt).some((o) => o.direct && o.bodies.length) &&
  !!sourcesOf(rt, true)

const LAYER_FORMAT: GPUTextureFormat = 'r8unorm'
const clearLayer: GPURenderPassColorAttachment = {
  view: undefined as never,
  loadOp: 'clear',
  storeOp: 'store',
  clearValue: [1, 1, 1, 1],
}
const CLEAR_LAYER: GPURenderPassDescriptor = {
  label: 'Trillion3D capsule shadows local layers',
  colorAttachments: [clearLayer],
}
const localTargets: GPUColorTargetState[] = [
  { format: LAYER_FORMAT, blend: CAPSULE_BLENDS.attenuation },
]
const localOutput = { targets: localTargets, attachments: [layerTarget] }

/** The layers texture for `count` layers at the buffers' size, made again when either changes (the old one retired after the frames in flight). */
function layersFor(h: Held, device: GPUDevice, extent: readonly [number, number], count: number) {
  const size = `${extent}|${count}`
  if (h.layers?.size === size) return h.layers
  const old = h.layers
  if (old) retire(device, { destroy: () => old.texture.destroy() })
  const texture = device.createTexture({
    label: 'Trillion3D capsule shadows local layers',
    size: [extent[0], extent[1], count],
    format: LAYER_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  return (h.layers = {
    texture,
    size,
    array: texture.createView({ dimension: '2d-array' }),
    each: Array.from({ length: count }, (_, layer) =>
      texture.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }),
    ),
  })
}

/**
 * THE CAPSULE SHADOWS OF THE LOCAL LIGHTS for the one-pass projection: a layer a light of the frame, cleared to a share of 1 and, for each local light the
 * shapes of the objects that cast a direct shadow reach, traced toward it and taken into its layer (the square root of the share, as the per-light mask
 * keeps it); the projection reads the layer where it packs the light's share (`VsmProjectionTarget.capsule`). None, and no pass or resource, where the
 * settings are off or no object casts.
 */
export function capsuleLocalLayers(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  encoder: GPUCommandEncoder,
  lights: readonly VsmProjectionLight[],
  suns: number,
) {
  const frame = directFrame(rt, cam)
  if (!frame || lights.length <= suns) return undefined
  // A light past the layers the device allows reads a share of 1 (the projection checks the layer count).
  const layers = layersFor(
    frame.h,
    frame.device,
    frame.image.extent,
    Math.min(lights.length, frame.device.limits.maxTextureArrayLayers),
  )
  for (const view of layers.each) {
    clearLayer.view = view
    encoder.beginRenderPass(CLEAR_LAYER).end()
  }
  const scissor = [0, 0, frame.image.view[0], frame.image.view[1]] as const
  for (let k = suns; k < layers.each.length; k++) {
    const light = lights[k]
    if (light.type === 'directional') continue
    const count = shapesWithin(
      frame,
      light.position,
      light.radius + frame.options.capsuleMaxDirectOcclusionDistance,
    )
    if (!count) continue
    layerTarget.view = layers.each[k]
    encodeCapsuleDirectShadows(frame.h.state, frame.device, encoder, {
      image: frame.image,
      settings: frame.options,
      sources: frame.sources,
      light: localLight(light),
      data: { shapes: frame.h.shapes, count },
      output: localOutput,
      scissor,
    })
  }
  return layers.array
}

const FACTORS_FORMAT: GPUTextureFormat = 'r8unorm'
/** Where the pixels of the factors buffer begin: a row's bytes in the first word, the pixels from here (`capsuleIndirectAt`). */
const FACTORS_OFFSET = 256
const factorsClear: GPURenderPassColorAttachment = {
  view: undefined as never,
  loadOp: 'clear',
  storeOp: 'store',
  clearValue: [1, 1, 1, 1],
}
const FACTORS_CLEAR: GPURenderPassDescriptor = {
  label: 'Trillion3D indirect capsule shadows clear',
  colorAttachments: [factorsClear],
}
const factorsTarget: GPURenderPassColorAttachment = {
  view: undefined as never,
  loadOp: 'load',
  storeOp: 'store',
}
const factorsOutput = {
  targets: [{ format: FACTORS_FORMAT }] as GPUColorTargetState[],
  attachments: [factorsTarget],
}

interface IndirectFactors {
  texture: GPUTexture
  view: GPUTextureView
  buffer: GPUBuffer
  rowBytes: number
  size: string
}
const factors = new WeakMap<object, IndirectFactors>()
/** The factors drawn this image, by the runtime: none until the encoding sets them, none again each image. */
const drawn = new WeakMap<object, { frame: number; buffer: GPUBuffer }>()

/** The factors' texture and buffer for an image of `extent` pixels, made again when it changes (the old ones retired after the frames in flight). */
function factorsFor(rt: WebgpuPagesRuntime, device: GPUDevice, extent: readonly [number, number]) {
  const size = `${extent}`
  const before = factors.get(rt)
  if (before?.size === size) return before
  if (before) retire(device, { destroy: () => (before.texture.destroy(), before.buffer.destroy()) })
  const rowBytes = alignUp(extent[0], 256)
  const texture = device.createTexture({
    label: 'Trillion3D indirect capsule shadows',
    size: [extent[0], extent[1]],
    format: FACTORS_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  const buffer = device.createBuffer({
    label: 'Trillion3D indirect capsule shadows',
    size: FACTORS_OFFSET + rowBytes * extent[1],
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, new Uint32Array([rowBytes]))
  const made = { texture, view: texture.createView(), buffer, rowBytes, size }
  factors.set(rt, made)
  return made
}

/** The objects with a distance field that cast an indirect shadow: the placements of the mesh fields whose nodes ask, with the capsule object each stands for. */
function fieldCasters(rt: WebgpuPagesRuntime, objects: readonly CapsuleObject[]) {
  const meshes = rt.distanceFields?.scene?.meshes
  if (!meshes || meshes.count === 0) return []
  const owners = new Map<object, CapsuleObject>()
  for (const o of objects) if (o.indirect && o.node) owners.set(o.node, o)
  const out: { index: number; owner: CapsuleObject }[] = []
  // The index of a placement is its place in the table: the records are written there (`objectBuffers.ts`, `write`); its `rank` is the cut root's.
  meshes.placements.forEach((placement, index) => {
    const node = rootSource(placement.root as unknown as Parameters<typeof rootSource>[0])
    const owner = node && owners.get(node)
    if (owner) out.push({ index, owner })
  })
  return out
}

/**
 * Whether this image will draw indirect capsule shadows: an object casts them, the settings allow it and the frame has what the pass reads. Asked at the
 * frame's entry to pick the lit program (`pickKeyOf`): the program holds the code that reads the factors only then.
 */
export function capsuleIndirectPlanned(rt: WebgpuPagesRuntime) {
  if (!capsuleObjectsOf(rt).some((o) => o.indirect)) return false
  return capsuleIndirectOn(capsuleSettingsOf(rt)) && !!sourcesOf(rt, true)
}

/**
 * THE INDIRECT CAPSULE SHADOWS OF THE IMAGE, before the lighting reads them (`DirectLightResources.capsuleIndirect`): the shapes of the objects that cast them and the
 * meshes with a distance field among them, traced toward the direction of the place's light each carries, drawn at the image's resolution into a byte a pixel and
 * copied into the buffer the indirect pass reads. R multiplies the colour of the scene that holds the indirect light by this
 * factor, after the diffuse indirect and the occlusion and before the direct lights; the lit pass multiplies the indirect light it adds, the direct lights'
 * not. None, and no pass or resource, where nothing is planned.
 */
export function encodeCapsuleIndirectFactors(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  drawn.delete(rt)
  if (!capsuleIndirectPlanned(rt)) return
  const objects = capsuleObjectsOf(rt)
  const options = capsuleSettingsOf(rt)
  const sources = sourcesOf(rt)!
  const h = heldOf(rt)
  const device = rt.gpu.device!
  const fields = fieldCasters(rt, objects)
  const data = indirectData(h, objects, skyKindOf(rt), fields)
  if (!data) return
  beginImage(rt, h)
  const frame = describe(rt, cam)
  const made = factorsFor(rt, device, frame.extent)
  factorsClear.view = made.view
  encoder.beginRenderPass(FACTORS_CLEAR).end()
  factorsTarget.view = made.view
  const drewAny = encodeCapsuleIndirectShadows(h.state, device, encoder, {
    image: frame,
    settings: options,
    sources: { ...sources, ...(fields.length && { objects: rt.distanceFields!.scene!.meshes }) },
    data,
    output: factorsOutput,
  })
  if (!drewAny) return
  encoder.copyTextureToBuffer(
    { texture: made.texture },
    { buffer: made.buffer, offset: FACTORS_OFFSET, bytesPerRow: made.rowBytes },
    [frame.extent[0], frame.extent[1]],
  )
  drawn.set(rt, { frame: rt.run.frame, buffer: made.buffer })
}

/** The factors buffer this image drew, none where it drew none. */
export const capsuleIndirectRead = (rt: WebgpuPagesRuntime) => {
  const d = drawn.get(rt)
  return d && d.frame === rt.run.frame ? d.buffer : undefined
}
