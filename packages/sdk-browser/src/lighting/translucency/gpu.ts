import { storageBufferCap } from '../../session/memory/pools.ts'
import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { ambientCubemapStandIn } from '../deferred/ambientCubemapFrame.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { TRANSLUCENCY_VOLUME_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { SimpleLights } from '../../../../sdk-core/src/scene/light/simpleLights.ts'
import type { TranslucencyVolumeValues } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { cloudShadowBindEntries, type CloudShadowSet } from '../atmosphere/cloudShadowRead.ts'
import {
  createProgramGroups,
  heldProgramGroup,
  keptProgramGroup,
} from '../../gpu/bind/programGroups.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { newCascade, placeCascade, cullLights, type Cascade, type CascadeView } from './bounds.ts'
import { FILTER_BINDING } from './filterWgsl.ts'
import { INJECT_BINDING } from './injectWgsl.ts'
import { FOG_BINDING } from '../fog/bindings.ts'
import type { SampledVolumeBinding } from '../manyLightsSampled/volume.ts'
import { ARGS_BINDING, CLEAR_BINDING, DILATE_BINDING, GATHER_BINDING } from './markWgsl.ts'
import {
  TRANSLUCENCY_CASCADES,
  TRANSLUCENCY_FRAME,
  TRANSLUCENCY_WORKGROUP,
  markedListBytes,
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
  /** The sampled lighting's volume this image, where the fog's built it (`sampledLightsVolume`): the injection lights the local lights from its samples. */
  readonly mlVolume?: SampledVolumeBinding
  /** Draws the translucency volume's own samples into the compute pass over the cascades as placed, where it does not share the fog's (`sampledLightsVolumeUnified` off): their binding. */
  readonly sampleCells?: (
    pass: GPUComputePassEncoder,
    cascades: readonly Cascade[],
    dim: number,
  ) => SampledVolumeBinding | undefined
  readonly camera: CascadeView
  readonly settings: TranslucencyVolumeValues
  /** The light store's table, the kind of a slot's light and how many lights there are and room for. */
  readonly lights: {
    readonly packed: ArrayLike<number>
    readonly kindOf: (slot: number) => number
    readonly count: number
    readonly capacity: number
    /** The simple lights, which follow the store's lights in the light buffer (`SimpleLightEntry`): those that affect translucency are listed too. */
    readonly simple: Pick<SimpleLights, 'packed' | 'count' | 'capacity' | 'affectsTranslucency'>
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
  /** The ambient cubemap's cube and colour this image (`ambientCubemapReady`), none where it has no light from the cube: the injection adds its mean colour to every cell. */
  readonly ambientCubemap?: { readonly view: GPUTextureView; readonly colour: GPUBuffer }
  /** The number the light is written multiplied by this image and the image before's. */
  readonly preExposure: number
  readonly previousPreExposure: number
  /** The exposure of this image, which a light's blend with it is taken at (`lightStrength`). */
  readonly exposure: number
  /** A camera cut: the image before is no history. */
  readonly cut: boolean
  /** The image's number: an image prepared for its marks is made only by the encoding of the same one. */
  readonly image: number
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
  /** Whether the image before marked its cells (its dilated marks are then the history of the marks), and which of the two dilated marks
   *  it wrote (`markPing`). */
  marked: boolean
  markPing: number
}

/** The entries of a filter's bind group (`FILTER_BINDING`): the frame, the injected light, the volume it reads and the one it writes. */
const filterEntries = (
  frame: GPUBuffer,
  injected: GPUTextureView,
  read: GPUTextureView,
  written: GPUTextureView,
  marks: MarksBound,
) =>
  namedEntries(FILTER_BINDING, {
    frame: { buffer: frame },
    injected,
    volume: read,
    written,
    marks: marks.now,
    historyMarks: marks.past,
  })

/** The marks the filters bind: this image's dilated marks and the image before's, the one-cell stand-in for each where the cells are not marked. */
interface MarksBound {
  readonly now: GPUTextureView
  readonly past: GPUTextureView
}

/** The state of a new view's volume work: nothing placed, no history, no volume published. */
function newVolumeState(device: GPUDevice, failed: (error: unknown) => void): VolumeState {
  return {
    device,
    resources: createTranslucencyResources(device, failed),
    groups: createTranslucencyGroups(),
    prepared: undefined,
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
      marked: false,
      markPing: 0,
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
    /** Asks the pipelines of the marked cells (`translucencyVolumeMarkVoxels`) now, off the frame: they are not asked unless the setting is on. */
    askMarks() {
      v.resources.markedPipelines()
    },
    /**
     * The cells the surfaces will read, to be marked before `encode` (`translucencyVolumeMarkVoxels`): the cascades placed and the frame
     * sent, the marks emptied on `steps`. Returns where the surfaces mark — the frame (the cascades' boxes and the cells a side, the
     * uniform `translucencyVolumeMarkWgsl` reads) and the texture they write —, none where the cells are not marked this image: the setting
     * is off, the pipelines are not compiled, the list would pass what a storage buffer binds, or the volume cannot be placed. `encode`
     * then makes the volume of the marked cells; called without a prepared image, it lights every cell.
     */
    prepare(steps: ComputeRun, input: TranslucencyInputs) {
      return prepareMarks(v, steps, input)
    },
    /** The scene's surfaces no longer read the volume, or the world closed: the history is dropped and the textures retired. */
    reset() {
      history.known = false
      history.marked = false
      v.prepared = undefined
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
type VolumeMarks = NonNullable<VolumeTextures['marks']>

/** What the volume's GPU work holds between images. */
interface VolumeState {
  readonly device: GPUDevice
  readonly resources: VolumeResources
  readonly groups: TranslucencyGroups
  readonly cascades: Cascade[]
  readonly counts: Uint32Array<ArrayBuffer>
  scratch: Uint32Array<ArrayBuffer>
  readonly history: History
  /** The image prepared for its marks (`prepareMarks`), until `encode` makes its volume. */
  prepared: Prepared | undefined
  readonly published: PublishedVolume
  /** How many images the temporal filter has blended since it began over (the camera cut, other textures). */
  frames: number
  horizon: number
  readonly maxDimension: number
}

/** What an image's placement leaves its passes: the cells a side, the textures, the list of ranks, whether the history holds and whether the
 *  cells are marked. */
interface Prepared {
  readonly dim: number
  readonly textures: VolumeTextures
  readonly ranks: GPUBuffer
  readonly kept: boolean
  readonly marked: boolean
  readonly image: number
}

const volumeReady = ({ resources }: VolumeState) =>
  resources.inject.pipeline.ready &&
  resources.temporal.pipeline.ready &&
  resources.blur.pipeline.ready

/** Whether the pipelines of the marked cells are compiled. */
const marksReady = ({ resources }: VolumeState) => {
  const { injectMarked, clear, dilate, gather, args } = resources.markedPipelines()
  return [injectMarked, clear, dilate, gather, args].every((stage) => stage.pipeline.ready)
}

/** Whether this image's cells are marked: the setting is on, the pipelines are compiled and the list of the cells fits a storage buffer's binding. */
const marking = (v: VolumeState, settings: TranslucencyVolumeValues, dim: number) => {
  if (!settings.translucencyVolumeMarkVoxels || !marksReady(v)) return false
  const { maxStorageBufferBindingSize = 134217728, maxBufferSize = 268435456 } =
    v.device.limits ?? {}
  return markedListBytes(dim) <= storageBufferCap({ maxStorageBufferBindingSize, maxBufferSize })
}

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
 *  holds, the lists' places, the filters, the pre-exposures, the eye and whether the cells are marked (`marked`). Returns whether the history holds. */
function writeFrame(
  v: VolumeState,
  input: TranslucencyInputs,
  dim: number,
  blur: boolean,
  generation: number,
  temporal: boolean,
  marked: boolean,
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
  u[at.marks] = marked ? 1 : 0
  u[at.marks + 1] = marked && kept && history.marked ? 1 : 0
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
  const words = 2 * Math.max(lights.capacity + lights.simple.capacity, 1)
  if (v.scratch.length < words) v.scratch = new Uint32Array(words)
  cullLights(
    lights.packed,
    lights.kindOf,
    lights.count,
    v.cascades,
    dim,
    v.scratch,
    v.counts,
    lights.simple,
  )
  const used = v.counts[0] + v.counts[1]
  const buffer = v.resources.ranksOf(words)
  // Only the ranks listed go up: the passes read no further.
  writeChanged(v.device, buffer, v.scratch, 0, Math.max(used, 1))
  return buffer
}

/** The marks this image's filters bind: the dilated marks of this image and of the image before where the cells are marked, else the stand-in. */
function marksBound(v: VolumeState, marks: VolumeMarks | undefined): MarksBound {
  const stand = v.resources.markStandIn
  if (!marks) return { now: stand, past: stand }
  const ping = v.history.markPing
  return { now: marks.dilated[ping], past: marks.dilated[1 - ping] }
}

/** Names the resources of the passes' groups, in their fixed order (`createTranslucencyGroups`). */
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
  const { marks } = textures
  const bound = marksBound(v, marks)
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
  injectNext[13] = marks?.list ?? v.resources.listStandIn
  injectNext[14] = marks?.count ?? v.resources.listStandIn
  const cube = cubeOf(v, input)
  injectNext[15] = cube.view
  injectNext[16] = cube.colour
  const temporalNext = v.groups.temporal.identity.next
  temporalNext[0] = textures.injected
  temporalNext[1] = past
  temporalNext[2] = now
  temporalNext[3] = bound.now
  temporalNext[4] = bound.past
  const blurNext = v.groups.blur.identity.next
  blurNext[0] = textures.injected
  blurNext[1] = now ?? v.resources.volumeStandIn
  blurNext[2] = blurred
  blurNext[3] = bound.now
  blurNext[4] = bound.past
}

/** Names the resources of the marks' passes' groups (`createTranslucencyGroups`). */
function nameMarkResources(v: VolumeState, marks: VolumeMarks, injected: GPUTextureView) {
  const dilated = marks.dilated[v.history.markPing]
  const clearNext = v.groups.clear.identity.next
  clearNext[0] = marks.marked
  clearNext[1] = dilated
  clearNext[2] = injected
  clearNext[3] = marks.count
  const dilateNext = v.groups.dilate.identity.next
  dilateNext[0] = marks.marked
  dilateNext[1] = dilated
  const gatherNext = v.groups.gather.identity.next
  gatherNext[0] = dilated
  gatherNext[1] = marks.count
  gatherNext[2] = marks.list
  const argsNext = v.groups.args.identity.next
  argsNext[0] = marks.count
  argsNext[1] = marks.args
}

/** The ambient cubemap the injection reads this image, the stand-in black cube where the image has none. */
const cubeOf = (v: VolumeState, input: TranslucencyInputs) =>
  input.ambientCubemap ?? ambientCubemapStandIn(v.device)

/** The entries of the injection's bind group. */
function injectEntries(
  v: VolumeState,
  input: TranslucencyInputs,
  textures: VolumeTextures,
  ranks: GPUBuffer,
) {
  const { vsm } = input
  const { marks } = textures
  const cube = cubeOf(v, input)
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
      marked: { buffer: marks?.list ?? v.resources.listStandIn },
      markedCount: { buffer: marks?.count ?? v.resources.listStandIn },
      ambientCube: cube.view,
      ambientCubeSampler: postSamplers(v.device).clamped,
      ambientCubeColour: { buffer: cube.colour },
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

/** The resources the injection names in its bind group's identity, before the sampled lighting's two. */
const INJECT_BOUND = 17

/** The injection of the volume, over its `x` × `x` × `z` workgroups of `pass`, or over the marked cells alone (`marks`) by the dispatch the
 *  arguments' kernel wrote. */
function dispatchInject(
  pass: GPUComputePassEncoder,
  v: VolumeState,
  input: TranslucencyInputs,
  textures: VolumeTextures,
  ranks: GPUBuffer,
  x: number,
  z: number,
  volume: SampledVolumeBinding | undefined,
) {
  const { device, resources, groups } = v
  const { marks } = textures
  const plain = marks ? resources.markedPipelines().injectMarked : resources.inject
  const sampledStages = volume ? resources.sampledInject() : undefined
  const sampled = marks ? sampledStages?.injectMarked : sampledStages?.inject
  const useSampled = !!sampled?.pipeline.ready
  const stage = useSampled ? sampled : plain
  const held = useSampled ? groups.injectSampled : groups.inject
  if (useSampled) {
    const from = groups.inject.identity.next
    const to = groups.injectSampled.identity.next
    for (let i = 0; i < INJECT_BOUND; i++) to[i] = from[i]
    to[INJECT_BOUND] = volume!.params
    to[INJECT_BOUND + 1] = volume!.samplesRead
  }
  const group =
    heldProgramGroup(held) ??
    keptProgramGroup(
      device,
      stage.layout,
      held,
      [
        ...injectEntries(v, input, textures, ranks),
        ...(useSampled
          ? namedEntries(FOG_BINDING, {
              mlParams: { buffer: volume!.params },
              mlSamplesIn: volume!.samplesRead,
            })
          : []),
      ],
      'Trillion3D translucency volume inject',
    )
  if (!marks) return dispatchVolumePass(pass, stage.pipeline.get(), group, x, z)
  const pipeline = stage.pipeline.get()
  if (!pipeline) return
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroupsIndirect(marks.args, 0)
}

/** The marks' passes of the image, before the injection: the dilation of the marks the surfaces wrote, the gathering of the cells it holds
 *  into the list and the dispatch over it. */
function dispatchMarks(
  pass: GPUComputePassEncoder,
  v: VolumeState,
  marks: VolumeMarks,
  x: number,
  z: number,
) {
  const { device, resources, groups } = v
  const stages = resources.markedPipelines()
  const dilated = marks.dilated[v.history.markPing]
  const frame = () => ({ buffer: resources.frame.buffer })
  // A pass over the marks: its group is made, from `entries`, only where the resources it names moved.
  const step = (
    stage: typeof stages.dilate,
    kept: ReturnType<typeof createProgramGroups>,
    entries: () => GPUBindGroupEntry[],
    label: string,
    wide: boolean,
  ) =>
    dispatchVolumePass(
      pass,
      stage.pipeline.get(),
      heldProgramGroup(kept) ?? keptProgramGroup(device, stage.layout, kept, entries(), label),
      wide ? x : 1,
      wide ? z : 1,
    )
  step(
    stages.dilate,
    groups.dilate,
    () => namedEntries(DILATE_BINDING, { frame: frame(), marks: marks.marked, dilated }),
    'Trillion3D translucency volume mark dilate',
    true,
  )
  step(
    stages.gather,
    groups.gather,
    () =>
      namedEntries(GATHER_BINDING, {
        frame: frame(),
        dilated,
        count: { buffer: marks.count },
        list: { buffer: marks.list },
      }),
    'Trillion3D translucency volume mark gather',
    true,
  )
  step(
    stages.args,
    groups.args,
    () =>
      namedEntries(ARGS_BINDING, { count: { buffer: marks.count }, args: { buffer: marks.args } }),
    'Trillion3D translucency volume mark args',
    false,
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
        filterEntries(
          resources.frame.buffer,
          textures.injected,
          past,
          now,
          marksBound(v, textures.marks),
        ),
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
          marksBound(v, textures.marks),
        ),
        'Trillion3D translucency volume blur',
      ),
    x,
    z,
  )
}

const VOLUME_PASS: GPUComputePassDescriptor = { label: TRANSLUCENCY_VOLUME_PASS }

/** The groups the volume's passes dispatch over: `x` along the two sides of a cascade and `z` along the two cascades stacked. */
const groupsOf = (dim: number) =>
  [
    ceilDiv(dim, TRANSLUCENCY_WORKGROUP),
    ceilDiv(TRANSLUCENCY_CASCADES * dim, TRANSLUCENCY_WORKGROUP),
  ] as const

/** The passes of the image, in one compute pass: where the cells are marked, the dilation of the marks and the list of the cells they hold;
 *  the injection; the temporal filter where `now` is the volume it writes (the image before's, `past`, its history) and the blur where
 *  `blurred` is the volume it writes (it reads the temporal filter's). */
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
  const [x, z] = groupsOf(textures.dim)
  const pass = steps.pass(VOLUME_PASS)
  if (textures.marks) {
    nameMarkResources(v, textures.marks, textures.injected)
    dispatchMarks(pass, v, textures.marks, x, z)
  }
  dispatchInject(
    pass,
    v,
    input,
    textures,
    ranks,
    x,
    z,
    input.mlVolume ?? input.sampleCells?.(pass, v.cascades, textures.dim),
  )
  if (now) dispatchTemporal(pass, v, textures, past, now, x, z)
  if (blurred) dispatchBlur(pass, v, textures, now, blurred, x, z)
}

/**
 * The image placed: the cascades round the camera, the textures of its cells a side (with the marks' where `wantMarks` and they can be
 * made, `marking`), the lights each cascade is lit by and the frame sent. None where a cascade holds nothing or the device's budget refuses
 * the textures; none, too, where marks are wanted and cannot be made.
 */
function prepareImage(v: VolumeState, input: TranslucencyInputs, wantMarks: boolean) {
  const { resources, history, cascades } = v
  const s = input.settings
  const dim = Math.min(s.translucencyVolumeDim, mostCellsPerSide(v.maxDimension))
  const marked = wantMarks && marking(v, s, dim)
  if (wantMarks && !marked) return undefined
  for (let c = 0; c < TRANSLUCENCY_CASCADES; c++) {
    placeCascade(cascades[c], c, input.camera, s, dim)
    if (!(cascades[c].size > 0)) return undefined
  }
  const temporal = s.translucencyVolumeTemporal
  const blur = s.translucencyVolumeBlur
  const textures = resources.texturesOf(dim, temporal, blur, marked)
  if (!textures) {
    history.known = false
    history.marked = false
    return undefined
  }
  const ranks = listLights(v, input, dim)
  const kept = writeFrame(v, input, dim, blur, resources.generation, temporal, marked)
  return { dim, textures, ranks, kept, marked, image: input.image } satisfies Prepared
}

/** The image prepared for the surfaces' marks (`TranslucencyVolumeGpu.prepare`): placed, its marks emptied on `steps`. */
function prepareMarks(v: VolumeState, steps: ComputeRun, input: TranslucencyInputs) {
  v.prepared = undefined
  if (!input.settings.translucencyVolumeMarkVoxels || !volumeReady(v)) return undefined
  const prepared = prepareImage(v, input, true)
  const marks = prepared?.textures.marks
  if (!prepared || !marks) return undefined
  v.prepared = prepared
  nameMarkResources(v, marks, prepared.textures.injected)
  const { resources, groups, device } = v
  const [x, z] = groupsOf(prepared.dim)
  dispatchVolumePass(
    steps.pass(VOLUME_PASS),
    resources.markedPipelines().clear.pipeline.get(),
    heldProgramGroup(groups.clear) ??
      keptProgramGroup(
        device,
        resources.markedPipelines().clear.layout,
        groups.clear,
        namedEntries(CLEAR_BINDING, {
          frame: { buffer: resources.frame.buffer },
          marks: marks.marked,
          dilated: marks.dilated[v.history.markPing],
          injected: prepared.textures.injected,
          count: { buffer: marks.count },
        }),
        'Trillion3D translucency volume mark clear',
      ),
    x,
    z,
  )
  return { frame: resources.frame.buffer, view: marks.marked, dim: prepared.dim }
}

function encodeVolume(v: VolumeState, steps: ComputeRun, input: TranslucencyInputs) {
  const { resources, history, published } = v
  const s = input.settings
  published.view = undefined
  const prepared = v.prepared
  v.prepared = undefined
  // The passes are compiled together (asked at the frame's entry, `askTranslucencyVolume`): the
  // history and its ping-pong move on only for a volume whose passes all ran.
  if (!volumeReady(v)) return false
  // An image the marks were not made for (the surfaces did not mark, or the setting is off) lights every cell.
  const image = prepared?.image === input.image ? prepared : prepareImage(v, input, false)
  if (!image) return false
  const { dim, textures, ranks, kept, marked } = image
  const temporal = s.translucencyVolumeTemporal
  const blur = s.translucencyVolumeBlur
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
  // The dilated marks of this image are the next image's history of the marks; the two take turns.
  history.marked = marked
  if (marked) history.markPing = 1 - history.markPing
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
