import { clamp } from '../../../math/src/scalar/reals.ts'
import { DEPTH_COMPARE_OR_EQUAL } from '../camera/depthConvention.ts'
import { DEPTH_FORMAT } from '../scene/targetFormats.ts'
import { preparedPipeline } from '../lighting/deferred/fullscreen.ts'
import { autoKernel } from '../gpu/core/computeStages.ts'
import { sequentialEntries } from '../gpu/core/computeBindings.ts'
import { ensureSet, type HeldSet } from '../gpu/core/heldTextures.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { uniformStride } from '../session/memory/pools.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import type { HairBoundsGpu } from './boundsPass.ts'
import type { HairNodes } from './compactionPass.ts'
import {
  deepShadowLayerDepths,
  deepShadowReaches,
  HAIR_DEEP_SHADOW_LIGHT_WORDS,
  HAIR_DEEP_SHADOW_MAX_SLOTS,
  HAIR_DEEP_SHADOW_MIN_NEAR,
  HAIR_DEEP_SHADOW_VIEW_INFO_BYTES,
  type HairDeepShadowLight,
  type HairDeepShadowSettings,
} from './deepShadowMath.ts'
import {
  DEEP_SHADOW_ALLOCATE_WGSL,
  DEEP_SHADOW_MASK_WGSL,
  DEEP_SHADOW_RASTER_WGSL,
  HAIR_DEEP_SHADOW_PARAM_WORDS,
} from './deepShadowWgsl.ts'
import { HAIR_VIEW_WORDS } from './ribbonWgsl.ts'
import { boundGroups, type DrawnInstance } from './ribbonBinds.ts'
import type { MacroGroup } from './macroGroups.ts'
import type { HairInstance } from './scene.ts'
import { wordViews } from '../gpu/core/wordViews.ts'

/** The format of the atlas of the layers: four channels of density. */
const LAYERS_FORMAT: GPUTextureFormat = 'rgba16float'
/** The least bytes between two blocks of a buffer a bind group names at an offset. */
const strideOf = (limits: GPUSupportedLimits) =>
  Math.max(uniformStride(limits), limits.minStorageBufferOffsetAlignment ?? 256)

const shaderModule = oncePerDevice((device) =>
  device.createShaderModule({ code: DEEP_SHADOW_RASTER_WGSL }),
)
const TRIANGLES: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'none' }

/** The pipeline that writes the nearest depth of the strands into the atlas. */
const frontPipeline = oncePerDevice((device) => {
  const module = shaderModule(device)
  return preparedPipeline(device, {
    label: `${HAIR_STRANDS_PASS_PREFIX}deep shadow front depth`,
    layout: 'auto',
    vertex: { module, entryPoint: 'hairDeepShadowVs' },
    fragment: { module, entryPoint: 'hairDeepShadowFrontFs', targets: [] },
    primitive: TRIANGLES,
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: DEPTH_COMPARE_OR_EQUAL,
    },
  })
})

/** The pipeline that adds the strands' coverage to the layers, by the blend unit. */
const layersPipeline = oncePerDevice((device) => {
  const module = shaderModule(device)
  const add: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' }
  return preparedPipeline(device, {
    label: `${HAIR_STRANDS_PASS_PREFIX}deep shadow layers`,
    layout: 'auto',
    vertex: { module, entryPoint: 'hairDeepShadowVs' },
    fragment: {
      module,
      entryPoint: 'hairDeepShadowLayersFs',
      targets: [{ format: LAYERS_FORMAT, blend: { color: add, alpha: add } }],
    },
    primitive: TRIANGLES,
  })
})

const allocateKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}deep shadow allocate`,
  DEEP_SHADOW_ALLOCATE_WGSL,
  'hairDeepShadowAllocate',
)
const maskKernel = autoKernel(
  `${HAIR_STRANDS_PASS_PREFIX}deep shadow mask`,
  DEEP_SHADOW_MASK_WGSL,
  'hairDeepShadowMask',
)

/** The pipelines of the deep shadows, none while one compiles. */
export function deepShadowPipelines(device: GPUDevice) {
  const front = frontPipeline(device).get()
  const layers = layersPipeline(device).get()
  const allocate = allocateKernel(device).get()
  const mask = maskKernel(device).get()
  return front && layers && allocate && mask ? { front, layers, allocate, mask } : undefined
}

/** The atlas of the fronts and of the layers, and the buffers the slots are described in. `stride` is the
 *  bytes between two blocks a bind group names at an offset. */
function allocateDeepShadow(allocator: ResourceAllocator, resolution: number, stride: number) {
  const attached = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  const slots = HAIR_DEEP_SHADOW_MAX_SLOTS
  const blocks = (label: string, kind: 'uniform' | 'storage', also = 0) =>
    allocator.buffer(label, (stride / 4) * slots, kind, also)
  return {
    frontDepth: allocator.image('front depth', [resolution, resolution], DEPTH_FORMAT, {
      usage: attached,
    }),
    layers: allocator.image('layers', [resolution, resolution], LAYERS_FORMAT, { usage: attached }),
    params: allocator.buffer('parameters', HAIR_DEEP_SHADOW_PARAM_WORDS, 'uniform'),
    lights: allocator.buffer('slot lights', HAIR_DEEP_SHADOW_LIGHT_WORDS * slots, 'storage'),
    viewInfos: allocator.buffer(
      'view infos',
      (HAIR_DEEP_SHADOW_VIEW_INFO_BYTES / 4) * slots,
      'storage',
    ),
    viewBlocks: blocks('view blocks', 'storage', GPUBufferUsage.UNIFORM),
    layerDepths: blocks('layer depths', 'uniform'),
    maskLights: blocks('light blocks', 'uniform'),
    slotMaps: blocks('slot maps', 'storage'),
  }
}

type DeepResources = ReturnType<typeof allocateDeepShadow>
interface DeepExtra {
  readonly resolution: number
  readonly stride: number
  readonly frontView: GPUTextureView
  readonly layersView: GPUTextureView
  readonly groups: Record<string, GPUBindGroup>
  /** The view's buffers the allocation's group names: it is made again when either is another. */
  allocateOver?: readonly [GPUBuffer, GPUBuffer]
  readonly frontPass: GPURenderPassDescriptor & {
    depthStencilAttachment: GPURenderPassDepthStencilAttachment
  }
  readonly layersPass: GPURenderPassDescriptor
}
/** The deep shadows' resources. */
export type HairDeepShadowSet = DeepResources & DeepExtra & HeldSet

/** What a view keeps of its deep shadows. */
export interface HairDeepShadowState {
  set?: HairDeepShadowSet
  dispose(): void
}

/** A view's deep shadows, none made yet. */
export function createHairDeepShadowState(): HairDeepShadowState {
  const state: HairDeepShadowState = {
    dispose() {
      state.set?.dispose()
      state.set = undefined
    },
  }
  return state
}

/** A deep shadow of a light on a macro group, and the slot of the atlas it is drawn in. */
interface Slot {
  readonly light: number
  readonly macro: number
}

/** What `encodeHairDeepShadows` reads of the image. */
interface HairDeepShadowFrame {
  readonly settings: HairDeepShadowSettings
  readonly lights: readonly HairDeepShadowLight[]
  readonly macroGroups: readonly MacroGroup<HairInstance>[]
  /** Every instance of each macro group, drawn or only casting, by the group's rank. */
  readonly groupInstances: readonly (readonly DrawnInstance[])[]
  readonly bounds: HairBoundsGpu
  /** The camera's view block (`HAIR_VIEW_WGSL`), which sizes the tiles by what they cover of the screen. */
  readonly viewBuffer: GPUBuffer
  readonly renderSize: readonly [number, number]
  readonly fail: (error: unknown) => void
}

/** The deep shadows an image drew. */
export interface HairDeepShadows {
  readonly set: HairDeepShadowSet
  /** One for each light that drew some, in the order of `frame.lights`. */
  readonly lights: readonly { readonly light: number; readonly offset: number }[]
}

const slotWords = new Uint32Array(HAIR_DEEP_SHADOW_LIGHT_WORDS * HAIR_DEEP_SHADOW_MAX_SLOTS)
const slotFloats = new Float32Array(slotWords.buffer)

/** The deep shadows' resources for `resolution`, made when they are not held. */
function ensureDeepShadow(
  device: GPUDevice,
  state: HairDeepShadowState,
  resolution: number,
  fail: (error: unknown) => void,
) {
  const stride = strideOf(device.limits)
  const made = ensureSet<DeepResources, DeepExtra>(
    state.set,
    device,
    {
      key: [resolution, stride],
      what: 'the deep shadows of the hair strands',
      label: `${HAIR_STRANDS_PASS_PREFIX}deep shadows`,
    },
    (allocator) => allocateDeepShadow(allocator, resolution, stride),
    (resources) => {
      const frontView = resources.frontDepth.createView()
      const layersView = resources.layers.createView()
      return {
        resolution,
        stride,
        frontView,
        layersView,
        groups: {},
        frontPass: {
          label: `${HAIR_STRANDS_PASS_PREFIX}deep shadow front depth`,
          colorAttachments: [],
          depthStencilAttachment: {
            view: frontView,
            depthClearValue: 0,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
          },
        },
        layersPass: {
          label: `${HAIR_STRANDS_PASS_PREFIX}deep shadow layers`,
          colorAttachments: [
            {
              view: layersView,
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: 'clear',
              storeOp: 'store',
            },
          ],
        },
      }
    },
  )
  if (!made.resources) {
    fail(new Error(`the hair deep shadows cannot be made: ${made.why ?? 'no room'}`))
    return undefined
  }
  state.set = made.resources
  return state.set
}

type DeepSet = NonNullable<ReturnType<typeof ensureDeepShadow>>
type DeepLights = HairDeepShadowFrame['lights']

/** The slots, a light and a macro group that meet each, as many as the atlas holds. */
function deepShadowSlots(macroGroups: HairDeepShadowFrame['macroGroups'], lights: DeepLights) {
  const slots: Slot[] = []
  macroGroups.forEach((group, macro) => {
    if (!group.supportsVoxelization) return
    lights.forEach((light, index) => {
      if (slots.length < HAIR_DEEP_SHADOW_MAX_SLOTS && deepShadowReaches(light, group.bounds))
        slots.push({ light: index, macro })
    })
  })
  return slots
}

/** The slot map and mask block of each light that drew some, written for it; those lights with where they were put. */
function writeDeepLightMaps(
  device: GPUDevice,
  set: DeepSet,
  { settings, lights }: HairDeepShadowFrame,
  slots: readonly Slot[],
  used: ReadonlySet<number>,
) {
  const { stride } = set
  const resolution = settings.resolution
  const slotMap = new Uint32Array(16)
  const maskBlock = wordViews(new ArrayBuffer(48))
  const reported: { light: number; offset: number }[] = []
  for (const index of [...used].sort((a, b) => a - b)) {
    const light = lights[index]!
    slotMap.fill(0xffffffff)
    slots.forEach((slot, at) => {
      if (slot.light === index) slotMap[slot.macro] = at
    })
    const offset = reported.length * stride
    device.queue.writeBuffer(set.slotMaps, offset, slotMap)
    const { u, f } = maskBlock
    f.fill(0)
    f.set(deepShadowLayerDepths(light.layerDistribution), 0)
    u[4] = light.lightChannels
    u[5] = settings.kernelType
    u[6] = resolution
    f[8] = settings.densityScale
    f[9] = settings.depthBiasScale
    f[10] = settings.kernelAperture
    device.queue.writeBuffer(set.maskLights, offset, u)
    reported.push({ light: index, offset })
  }
  return reported
}

/** The slots' lights, the parameters, the layers of each slot's light and the slot map and mask block of each light; the lights that drew some. */
function writeDeepSlots(
  device: GPUDevice,
  set: DeepSet,
  frame: HairDeepShadowFrame,
  slots: readonly Slot[],
) {
  const { settings, lights, macroGroups } = frame
  const { stride } = set
  const resolution = settings.resolution
  slotWords.fill(0)
  const used = new Set<number>()
  slots.forEach(({ light: index, macro }, slot) => {
    const light = lights[index]!
    const at = slot * HAIR_DEEP_SHADOW_LIGHT_WORDS
    // The way the light shines (a local light's is found from its place and the group's centre).
    slotFloats.set(light.directional ? light.vector : [0, 0, 0], at)
    slotWords[at + 3] = macro
    slotFloats.set(light.directional ? [0, 0, 0] : light.vector, at + 4)
    slotWords[at + 7] = light.directional ? 1 : 0
    used.add(index)
  })
  device.queue.writeBuffer(set.lights, 0, slotWords)
  const params = wordViews(new ArrayBuffer(HAIR_DEEP_SHADOW_PARAM_WORDS * 4))
  const minTile = Math.floor(Math.log2(clamp(settings.minResolution, 16, resolution)))
  params.u[0] = resolution
  params.u[1] = slots.length
  params.u[2] = macroGroups.length
  params.u[3] = minTile
  params.u[4] = resolution
  params.f[5] = settings.rasterizationScale
  params.f[6] = settings.aabbScale
  params.f[7] = settings.maxHalfFov
  params.f[8] = 1 / resolution
  params.f[9] = HAIR_DEEP_SHADOW_MIN_NEAR
  device.queue.writeBuffer(set.params, 0, params.u)

  const layerBlock = new Float32Array(4)
  slots.forEach(({ light: index }, slot) => {
    layerBlock.set(deepShadowLayerDepths(lights[index]!.layerDistribution))
    device.queue.writeBuffer(set.layerDepths, slot * stride, layerBlock)
  })
  return writeDeepLightMaps(device, set, frame, slots, used)
}

/** The bind group `name` of the set for `pipeline`, made once. */
const deepGroup = (
  device: GPUDevice,
  set: DeepSet,
  name: string,
  pipeline: GPUComputePipeline | GPURenderPipeline,
  entries: GPUBindGroupEntry[],
  group: number,
) =>
  (set.groups[name] ??= device.createBindGroup({
    layout: pipeline.getBindGroupLayout(group),
    entries,
  }))

/** The views of the slots' lights, allocated in one pass. */
function encodeDeepAllocate(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  set: DeepSet,
  allocatePipeline: GPUComputePipeline,
  frame: HairDeepShadowFrame,
) {
  const { viewBuffer, bounds } = frame
  const over = set.allocateOver
  if (over?.[0] !== viewBuffer || over[1] !== bounds.macroAabb) {
    delete set.groups.allocate
    set.allocateOver = [viewBuffer, bounds.macroAabb]
  }
  const allocate = encoder.beginComputePass({
    label: `${HAIR_STRANDS_PASS_PREFIX}deep shadow allocate`,
  })
  allocate.setPipeline(allocatePipeline)
  allocate.setBindGroup(
    0,
    deepGroup(
      device,
      set,
      'allocate',
      allocatePipeline,
      sequentialEntries([
        { buffer: set.params },
        { buffer: viewBuffer },
        { buffer: set.lights },
        { buffer: bounds.macroAabb },
        { buffer: set.viewInfos },
        { buffer: set.viewBlocks },
      ]),
      0,
    ),
  )
  allocate.dispatchWorkgroups(1)
  allocate.end()
}

/** The strands of each slot's macro group drawn into the atlas, the depth of the nearest and then the layers. */
function encodeDeepSlotViews(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  set: DeepSet,
  pipelines: NonNullable<ReturnType<typeof deepShadowPipelines>>,
  frame: HairDeepShadowFrame,
  slots: readonly Slot[],
) {
  const { stride } = set
  const resolution = frame.settings.resolution
  const blockBytes = HAIR_VIEW_WORDS * 4
  slots.forEach(({ macro }, slot) => {
    const instances = frame.groupInstances[macro] ?? []
    const view = (): GPUBindGroupEntry => ({
      binding: 0,
      resource: { buffer: set.viewBlocks, offset: slot * stride, size: blockBytes },
    })
    for (const phase of ['front', 'layers'] as const) {
      const pipeline = phase === 'front' ? pipelines.front : pipelines.layers
      const descriptor = phase === 'front' ? set.frontPass : set.layersPass
      // The first slot clears the atlas, the others add to what is there.
      const first = slot === 0
      if (phase === 'front') {
        set.frontPass.depthStencilAttachment.depthLoadOp = first ? 'clear' : 'load'
      } else {
        ;(descriptor.colorAttachments as GPURenderPassColorAttachment[])[0]!.loadOp = first
          ? 'clear'
          : 'load'
      }
      const pass = encoder.beginRenderPass(descriptor)
      pass.setViewport(0, 0, resolution, resolution, 0, 1)
      pass.setPipeline(pipeline)
      pass.setBindGroup(
        1,
        deepGroup(
          device,
          set,
          `${phase}${slot}`,
          pipeline,
          phase === 'front'
            ? [view()]
            : [
                view(),
                { binding: 1, resource: set.frontView },
                {
                  binding: 2,
                  resource: { buffer: set.layerDepths, offset: slot * stride, size: 16 },
                },
              ],
          1,
        ),
      )
      for (const instance of instances) {
        pass.setBindGroup(0, instance.group(pipeline))
        pass.draw(instance.pointCount * 6)
      }
      pass.end()
    }
  })
}

/**
 * Draws the deep shadows of the lights over the macro groups of an image on `encoder`, in the reference's
 * order: a slot for each light and macro group that meet (the lights' reach, at most
 * `HAIR_DEEP_SHADOW_MAX_SLOTS`), the views and tiles of the slots allocated on the GPU, then each slot's
 * strands drawn twice, the nearest depth and then the layers. Returns the atlas and where each light's
 * slots lie, none while a program compiles, no light reaches a group or the resources cannot be made.
 */
export function encodeHairDeepShadows(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: HairDeepShadowState,
  frame: HairDeepShadowFrame,
): HairDeepShadows | undefined {
  const slots = deepShadowSlots(frame.macroGroups, frame.lights)
  if (!slots.length) return undefined
  const pipelines = deepShadowPipelines(device)
  if (!pipelines) return undefined
  const set = ensureDeepShadow(device, state, frame.settings.resolution, frame.fail)
  if (!set) return undefined
  const reported = writeDeepSlots(device, set, frame, slots)
  encodeDeepAllocate(device, encoder, set, pipelines.allocate, frame)
  encodeDeepSlotViews(device, encoder, set, pipelines, frame, slots)
  return { set, lights: reported }
}

/** What a light's deep shadow transmittance reads and writes, kept by the caller across images. */
export interface DeepShadowMaskTarget {
  readonly mask: GPUBuffer
  /** The window of `mask` the light writes, in bytes (the lights' masks lie one after the other). */
  readonly maskOffset: number
  readonly maskSize: number
  /** The camera's view block (`HAIR_VIEW_WGSL`). */
  readonly viewBuffer: GPUBuffer
  /** The light's bytes into the set's slot maps and light blocks (`HairDeepShadows.lights`). */
  readonly offset: number
}

/** The bind group of a light's deep shadow transmittance, kept while the resources it names stay. */
export const deepShadowMaskBinds = () =>
  boundGroups<HairDeepShadowSet, HairNodes, DeepShadowMaskTarget>(
    8,
    (device, pipeline, set, nodes, target) =>
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: sequentialEntries([
          { buffer: nodes.nodeCoord },
          { buffer: nodes.nodeData },
          { buffer: nodes.nodeCounter },
          { buffer: target.mask, offset: target.maskOffset, size: target.maskSize },
          { buffer: target.viewBuffer },
          { buffer: set.maskLights, offset: target.offset, size: 48 },
          { buffer: set.slotMaps, offset: target.offset, size: 64 },
          { buffer: set.viewInfos },
          set.frontView,
          set.layersView,
        ]),
      }),
  )

/** Encodes the transmittance toward one light from its deep shadow over the stored samples of `nodes`. */
export function encodeDeepShadowMask(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  binds: ReturnType<typeof deepShadowMaskBinds>,
  shadows: HairDeepShadows,
  nodes: HairNodes,
  target: DeepShadowMaskTarget,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, binds(device, pipeline, shadows.set, nodes, target))
  pass.dispatchWorkgroupsIndirect(nodes.nodeArgs, 0)
}
