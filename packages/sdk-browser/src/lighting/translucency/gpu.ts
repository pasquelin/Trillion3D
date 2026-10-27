import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { TRANSLUCENCY_VOLUME_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { TranslucencyVolumeValues } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { cloudShadowBindEntries, type CloudShadowSet } from '../atmosphere/cloudShadowRead.ts'
import { heldProgramGroup, keptProgramGroup } from '../../gpu/bind/programGroups.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { newCascade, placeCascade, cullLights, type Cascade, type CascadeView } from './bounds.ts'
import { FILTER_BINDING } from './filterWgsl.ts'
import { INJECT_BINDING } from './injectWgsl.ts'
import {
  TRANSLUCENCY_CASCADES,
  TRANSLUCENCY_FRAME,
  TRANSLUCENCY_WORKGROUP,
  mostCellsPerSide,
} from './layout.ts'
import {
  INJECT_CLOUD_SHADOW,
  createTranslucencyGroups,
  createTranslucencyResources,
  madeByBlur,
  type TranslucencyGroups,
} from './resources.ts'

/** What an image gives the volume's passes: the camera, the settings, the lights and what a light's colour is read through. */
export interface TranslucencyInputs {
  readonly camera: CascadeView
  readonly settings: TranslucencyVolumeValues
  /** The light store's table, the kind of a slot's light and how many lights there are and room for. */
  readonly lights: {
    readonly packed: ArrayLike<number>
    readonly kindOf: (slot: number) => number
    readonly count: number
    readonly capacity: number
  }
  /** The light buffer the lights are read from, and the virtual shadow maps their shadow is read through (the very ones a
   *  blended surface binds, or their stand-ins). */
  readonly lightBuffer: GPUBuffer
  readonly vsm: {
    readonly pageTable: GPUBuffer
    readonly projectionData: GPUBuffer
    readonly uniforms: GPUBuffer
    readonly pool: GPUBuffer
    readonly view: GPUBuffer
  }
  /** The light functions' atlas and the clouds' shade, or the stand-ins that answer none. */
  readonly lightFunction: GPUTextureView
  readonly cloudShadow: CloudShadowSet
  /** The number the light is written multiplied by this image and the image before's. */
  readonly preExposure: number
  readonly previousPreExposure: number
  /** The exposure of this image, which a light's blend with it is taken at (`lightStrength`). */
  readonly exposure: number
  /** A camera cut: the image before is no history. */
  readonly cut: boolean
}

/** What the surfaces read of this image's volume: the texture, the cascades' boxes as `BlendView` holds them (`corner`, `scale`: two
 *  `vec4f` each), the cells a side and the radius, in cells, of the noise moving the point they read it at
 *  (`translucencyVolumePositionOffsetRadius`). One object, rewritten each image. */
interface PublishedVolume {
  view: GPUTextureView | undefined
  dim: number
  offsetRadius: number
  readonly corner: Float32Array
  readonly scale: Float32Array
}

/** What the volume remembers of the image before: the cascades' boxes, the cells a side and the textures it wrote
 *  (a count of the makings), which of the two temporal volumes it wrote, and whether the history is whole. */
interface History {
  readonly corner: Float32Array
  readonly scale: Float32Array
  dim: number
  generation: number
  ping: number
  known: boolean
}

/** The entries of a filter's bind group (`FILTER_BINDING`): the frame, the injected light, the volume it reads and the one it writes. */
const filterEntries = (
  frame: GPUBuffer,
  injected: GPUTextureView,
  read: GPUTextureView,
  written: GPUTextureView,
) =>
  namedEntries(FILTER_BINDING, {
    frame: { buffer: frame },
    injected,
    volume: read,
    written,
  })

/** The state of a new view's volume work: nothing placed, no history, no volume published. */
function newVolumeState(device: GPUDevice, failed: (error: unknown) => void): VolumeState {
  return {
    device,
    resources: createTranslucencyResources(device, failed),
    groups: createTranslucencyGroups(),
    cascades: Array.from({ length: TRANSLUCENCY_CASCADES }, newCascade),
    counts: new Uint32Array(TRANSLUCENCY_CASCADES),
    scratch: new Uint32Array(128),
    history: {
      corner: new Float32Array(TRANSLUCENCY_CASCADES * 4),
      scale: new Float32Array(TRANSLUCENCY_CASCADES * 4),
      dim: 0,
      generation: 0,
      ping: 0,
      known: false,
    },
    published: {
      view: undefined,
      dim: 0,
      offsetRadius: 0,
      corner: new Float32Array(TRANSLUCENCY_CASCADES * 4),
      scale: new Float32Array(TRANSLUCENCY_CASCADES * 4),
    },
    frames: 0,
    horizon: 0,
    maxDimension: device.limits?.maxTextureDimension3D ?? 2048,
  }
}

/**
 * THE TRANSLUCENCY LIGHTING VOLUME'S GPU WORK, made once a scene's surfaces are lit from it and kept while they are: the cascades
 * placed round the camera (`placeCascade`), the lights each reaches listed (`cullLights`), the light injected into the cells
 * (`injectWgsl.ts`) and filtered — the blend with the image before, then the blur — into the volume the surfaces read
 * (`filterWgsl.ts`), in one compute pass.
 * Its pipelines compile off the frame (the frames wait for them); the textures follow the cells a side the settings ask, within what the
 * device's 3D textures hold, and the device's budget may refuse them: the surfaces then read black. One per view: the history follows
 * the camera of the view that made it.
 */
export function createTranslucencyVolumeGpu(device: GPUDevice, failed: (error: unknown) => void) {
  const v = newVolumeState(device, failed)
  const { resources, history, published } = v

  return {
    /** Whether the volume still advances toward the light its history converges to: a still view is drawn again till
     *  it is whole (`translucencyVolumeHistoryWeight`'s share, as the fog's volume does), then held. */
    get settling() {
      return history.known && v.frames < v.horizon
    },
    /** Whether every pipeline is compiled: until then the image builds no volume. */
    get ready() {
      return volumeReady(v)
    },
    /** Bytes of the textures the volume holds. */
    get bytes() {
      return resources.bytes
    },
    /** What the surfaces read of the volume the last image built: none until one was. */
    published,
    /**
     * The volume of this image, built on `encoder`: placed round the camera, lit by the lights each cascade reaches, filtered. Returns
     * whether it was built (`published` then holds it): not where a cascade holds nothing, where the device's budget refuses the
     * textures, or where the pipelines are not compiled.
     */
    encode(steps: ComputeRun, input: TranslucencyInputs) {
      return encodeVolume(v, steps, input)
    },
    /** The scene's surfaces no longer read the volume, or the world closed: the history is dropped and the textures retired. */
    reset() {
      history.known = false
      published.view = undefined
      resources.release()
    },
    dispose() {
      resources.dispose()
    },
  }
}

type VolumeResources = ReturnType<typeof createTranslucencyResources>
type VolumeTextures = NonNullable<ReturnType<VolumeResources['texturesOf']>>

/** What the volume's GPU work holds between images. */
interface VolumeState {
  readonly device: GPUDevice
  readonly resources: VolumeResources
  readonly groups: TranslucencyGroups
  readonly cascades: Cascade[]
  readonly counts: Uint32Array<ArrayBuffer>
  scratch: Uint32Array<ArrayBuffer>
  readonly history: History
  readonly published: PublishedVolume
  /** How many images the temporal filter has blended since it began over (the camera cut, other textures). */
  frames: number
  horizon: number
  readonly maxDimension: number
}

const volumeReady = ({ resources }: VolumeState) =>
  resources.inject.pipeline.ready &&
  resources.temporal.pipeline.ready &&
  resources.blur.pipeline.ready

/** The cascades' boxes of this image into the frame's words, and the image before's where the history holds. */
function writeBoxes(v: VolumeState, dim: number, kept: boolean) {
  const { history, published } = v
  const { f } = v.resources.frame.words
  const at = TRANSLUCENCY_FRAME.at
  for (let c = 0; c < TRANSLUCENCY_CASCADES; c++) {
    const { min, size, voxel } = v.cascades[c]
    const o = 4 * c
    putVec4(f, at.corner + o, min[0], min[1], min[2], 1 / dim)
    putVec4(f, at.scale + o, 1 / size, 1 / size, 1 / size, voxel)
    // The image before's box, where its volume is the history: its corner and the side of its cells.
    if (kept)
      putVec4(
        f,
        at.prevCorner + o,
        history.corner[o],
        history.corner[o + 1],
        history.corner[o + 2],
        0,
      )
    else putVec4(f, at.prevCorner + o, 0, 0, 0, 0)
    putVec4(f, at.prevScale + o, 1, 1, 1, kept ? history.scale[o + 3] : 1)
    for (let k = 0; k < 4; k++) {
      published.corner[o + k] = f[at.corner + o + k]
      published.scale[o + k] = f[at.scale + o + k]
    }
  }
}

/** The frame's words (`TRANSLUCENCY_FRAME`) for this image: the cascades' boxes, those of the image before where the history
 *  holds, the lists' places, the filters, the pre-exposures and the eye. Returns whether the history holds. */
function writeFrame(
  v: VolumeState,
  input: TranslucencyInputs,
  dim: number,
  blur: boolean,
  generation: number,
  temporal: boolean,
) {
  const { resources, history, counts } = v
  const { f, u } = resources.frame.words
  const at = TRANSLUCENCY_FRAME.at
  const kept =
    temporal &&
    history.known &&
    !input.cut &&
    history.dim === dim &&
    history.generation === generation
  writeBoxes(v, dim, kept)
  const lists = at.lists
  u[lists] = 0
  u[lists + 1] = counts[0]
  u[lists + 2] = counts[0]
  u[lists + 3] = counts[1]
  u[at.mode] = dim
  u[at.mode + 1] = blur ? 1 : 0
  u[at.mode + 2] = kept ? 1 : 0
  u[at.mode + 3] = temporal ? 1 : 0
  putVec4(
    f,
    at.weights,
    input.preExposure,
    input.preExposure / input.previousPreExposure,
    input.settings.translucencyVolumeHistoryWeight,
    input.exposure,
  )
  putVec4(f, at.eye, input.camera.eye[0], input.camera.eye[1], input.camera.eye[2], 1)
  resources.frame.send()
  return kept
}

/** The lights each cascade is lit by, listed into the buffer of ranks (sent where they changed): the counts it leaves. */
function listLights(v: VolumeState, input: TranslucencyInputs, dim: number) {
  const { lights } = input
  const words = 2 * Math.max(lights.capacity, 1)
  if (v.scratch.length < words) v.scratch = new Uint32Array(words)
  cullLights(lights.packed, lights.kindOf, lights.count, v.cascades, dim, v.scratch, v.counts)
  const used = v.counts[0] + v.counts[1]
  const buffer = v.resources.ranksOf(words)
  // Only the ranks listed go up: the passes read no further.
  writeChanged(v.device, buffer, v.scratch, 0, Math.max(used, 1))
  return buffer
}

/** Names the resources of the three passes' groups, in their fixed order (`createTranslucencyGroups`). */
function nameVolumeResources(
  v: VolumeState,
  input: TranslucencyInputs,
  textures: VolumeTextures,
  ranks: GPUBuffer,
  now: GPUTextureView | undefined,
  past: GPUTextureView,
  blurred: GPUTextureView | undefined,
) {
  const { vsm } = input
  const injectNext = v.groups.inject.identity.next
  injectNext[0] = input.lightBuffer
  injectNext[1] = ranks
  injectNext[2] = textures.injected
  injectNext[3] = vsm.pageTable
  injectNext[4] = vsm.projectionData
  injectNext[5] = vsm.uniforms
  injectNext[6] = vsm.pool
  injectNext[7] = vsm.view
  injectNext[8] = input.lightFunction
  injectNext[9] = input.cloudShadow.block
  injectNext[10] = input.cloudShadow.maps[0]
  injectNext[11] = input.cloudShadow.maps[1]
  injectNext[12] = input.cloudShadow.sampler
  const temporalNext = v.groups.temporal.identity.next
  temporalNext[0] = textures.injected
  temporalNext[1] = past
  temporalNext[2] = now
  const blurNext = v.groups.blur.identity.next
  blurNext[0] = textures.injected
  blurNext[1] = now ?? v.resources.volumeStandIn
  blurNext[2] = blurred
}

/** The entries of the injection's bind group. */
function injectEntries(
  v: VolumeState,
  input: TranslucencyInputs,
  textures: VolumeTextures,
  ranks: GPUBuffer,
) {
  const { vsm } = input
  return [
    ...namedEntries(INJECT_BINDING, {
      lights: { buffer: input.lightBuffer },
      frame: { buffer: v.resources.frame.buffer },
      ranks: { buffer: ranks },
      injected: textures.injected,
      pageTable: { buffer: vsm.pageTable },
      projectionData: { buffer: vsm.projectionData },
      shadowUniforms: { buffer: vsm.uniforms },
      pool: { buffer: vsm.pool },
      shadowView: { buffer: vsm.view },
      lightFunction: input.lightFunction,
    }),
    ...cloudShadowBindEntries(INJECT_CLOUD_SHADOW, input.cloudShadow),
  ]
}

/** One pass of the volume over its `x` × `x` × `z` workgroups; nothing while its program is not compiled. */
function dispatchVolumePass(
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline | undefined,
  group: GPUBindGroup,
  x: number,
  z: number,
) {
  if (!pipeline) return
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(x, x, z)
}

/** The injection of the volume, over its `x` × `x` × `z` workgroups of `pass`. */
function dispatchInject(
  pass: GPUComputePassEncoder,
  v: VolumeState,
  input: TranslucencyInputs,
  textures: VolumeTextures,
  ranks: GPUBuffer,
  x: number,
  z: number,
) {
  const { device, resources, groups } = v
  dispatchVolumePass(
    pass,
    resources.inject.pipeline.get(),
    heldProgramGroup(groups.inject) ??
      keptProgramGroup(
        device,
        resources.inject.layout,
        groups.inject,
        injectEntries(v, input, textures, ranks),
        'Trillion3D translucency volume inject',
      ),
    x,
    z,
  )
}

/** The temporal filter of the volume: `past`, the image before's, into `now`. */
function dispatchTemporal(
  pass: GPUComputePassEncoder,
  v: VolumeState,
  textures: VolumeTextures,
  past: GPUTextureView,
  now: GPUTextureView,
  x: number,
  z: number,
) {
  const { device, resources, groups } = v
  dispatchVolumePass(
    pass,
    resources.temporal.pipeline.get(),
    heldProgramGroup(groups.temporal) ??
      keptProgramGroup(
        device,
        resources.temporal.layout,
        groups.temporal,
        filterEntries(resources.frame.buffer, textures.injected, past, now),
        'Trillion3D translucency volume temporal filter',
      ),
    x,
    z,
  )
}

/** The blur of the volume: `now` (the temporal filter's volume, or the stand-in without one) into `blurred`. */
function dispatchBlur(
  pass: GPUComputePassEncoder,
  v: VolumeState,
  textures: VolumeTextures,
  now: GPUTextureView | undefined,
  blurred: GPUTextureView,
  x: number,
  z: number,
) {
  const { device, resources, groups } = v
  dispatchVolumePass(
    pass,
    resources.blur.pipeline.get(),
    heldProgramGroup(groups.blur) ??
      keptProgramGroup(
        device,
        resources.blur.layout,
        groups.blur,
        filterEntries(
          resources.frame.buffer,
          textures.injected,
          now ?? resources.volumeStandIn,
          blurred,
        ),
        'Trillion3D translucency volume blur',
      ),
    x,
    z,
  )
}

const VOLUME_PASS: GPUComputePassDescriptor = { label: TRANSLUCENCY_VOLUME_PASS }

/** The passes of the image, in one compute pass: the injection, the temporal filter where `now` is the volume it writes (the
 *  image before's, `past`, its history) and the blur where `blurred` is the volume it writes (it reads the temporal filter's). */
function encodePasses(
  v: VolumeState,
  steps: ComputeRun,
  input: TranslucencyInputs,
  textures: VolumeTextures,
  ranks: GPUBuffer,
  now: GPUTextureView | undefined,
  past: GPUTextureView,
  blurred: GPUTextureView | undefined,
) {
  nameVolumeResources(v, input, textures, ranks, now, past, blurred)
  const dim = textures.dim
  const x = ceilDiv(dim, TRANSLUCENCY_WORKGROUP)
  const z = ceilDiv(TRANSLUCENCY_CASCADES * dim, TRANSLUCENCY_WORKGROUP)
  const pass = steps.pass(VOLUME_PASS)
  dispatchInject(pass, v, input, textures, ranks, x, z)
  if (now) dispatchTemporal(pass, v, textures, past, now, x, z)
  if (blurred) dispatchBlur(pass, v, textures, now, blurred, x, z)
}

function encodeVolume(v: VolumeState, steps: ComputeRun, input: TranslucencyInputs) {
  const { resources, history, published, cascades } = v
  const s = input.settings
  published.view = undefined
  // The three passes are compiled together (asked at the frame's entry, `askTranslucencyVolume`): the
  // history and its ping-pong move on only for a volume whose passes all ran.
  if (!volumeReady(v)) return false
  const dim = Math.min(s.translucencyVolumeDim, mostCellsPerSide(v.maxDimension))
  for (let c = 0; c < TRANSLUCENCY_CASCADES; c++) {
    placeCascade(cascades[c], c, input.camera, s, dim)
    if (!(cascades[c].size > 0)) return false
  }
  const temporal = s.translucencyVolumeTemporal
  const blur = s.translucencyVolumeBlur
  const textures = resources.texturesOf(dim, temporal, blur)
  if (!textures) {
    history.known = false
    return false
  }
  const ranks = listLights(v, input, dim)
  const kept = writeFrame(v, input, dim, blur, resources.generation, temporal)
  // The temporal filter's volume written this image and the one before it, where there is one: the two take turns.
  const now = temporal ? textures.history[history.ping] : undefined
  const past = temporal && kept ? textures.history[1 - history.ping] : resources.volumeStandIn
  encodePasses(v, steps, input, textures, ranks, now, past, textures.blurred)
  // What the surfaces read: the blur's volume, or the temporal filter's where the blur is off (`madeByBlur`).
  published.view = madeByBlur(temporal, blur) ? textures.blurred : now
  published.dim = dim
  published.offsetRadius = s.translucencyVolumePositionOffsetRadius
  history.corner.set(published.corner)
  history.scale.set(published.scale)
  history.dim = dim
  history.generation = resources.generation
  history.known = temporal
  history.ping = temporal ? 1 - history.ping : 0
  v.frames = kept ? v.frames + 1 : 1
  v.horizon = temporal ? historyImages(s.translucencyVolumeHistoryWeight) : 1
  return true
}

/** The images a still view takes to make its volume whole, the history blended in by `share` each: the error of the first image is
 *  that share to the power of the images, whole once it is under a step of eight bits. */
export function historyImages(share: number) {
  if (!(share > 0) || share >= 1) return 1
  const images = Math.log(1 / 256) / Math.log(share)
  return Math.ceil(images)
}

/** The volume's GPU work (`createTranslucencyVolumeGpu`). */
export type TranslucencyVolumeGpu = ReturnType<typeof createTranslucencyVolumeGpu>
