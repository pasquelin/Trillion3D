/**
 * Host side of the projection (`projectionWgsl.ts`): the view uniform, the pipelines (subgroup /
 * shared-memory vote variants), the dispatch into the engine's mask, and the view uniform fields the
 * projection reads (inverse device Z to world Z transform, screen ray length multiplier, tan and
 * inverse tan of the half field of view).
 *
 * CONVENTIONS. This engine's view space looks down −Z (right-handed); the projection's looks down
 * +Z: its view matrices are ours with view Z negated (shiftedToView = flipZ · view ·
 * T(originShift), viewToClip = projection · flipZ); shiftedToClip is unchanged. Depth is
 * reverse-Z in both. Shifted = world + originShift (default −camera position), the
 * same split double the projection data carries.
 */
import {
  computeTextureEntry,
  computeUniformEntry,
  sequentialEntries,
  namedEntries,
} from '../gpu/core/computeBindings.ts'
import { NO_CONE } from '../../../sdk-core/src/scene/light/fields.ts'
import { hasSubgroups } from '../gpu/core/subgroups.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { hizDepthBindEntries, hizDepthEntries } from '../gpu/hiz/pyramidTexture.ts'
import type { HizDepth } from '../gpu/hiz/types.ts'
import { screenSlab } from '../gpu/hiz/screenSlab.ts'
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import {
  copyMatrix4,
  multiplyMatrix4,
  negateColumnMatrix4,
  negateRowMatrix4,
} from '../../../math/src/matrix/matrix4.ts'
import { matrixAtRenderOrigin } from '../../../math/src/projection/renderOrigin.ts'
import {
  preparedComputePipeline,
  preparedPipelines,
  started,
  type PreparedPipelines,
} from '../lighting/deferred/fullscreen.ts'
import { createVsmBlueNoiseTexture, VSM_BLUE_NOISE_BYTES } from './blueNoise.ts'
import {
  VSM_LIGHT_KIND_DIRECTIONAL,
  VSM_LIGHT_KIND_POINT,
  VSM_LIGHT_KIND_RECT,
  VSM_LIGHT_KIND_SPOT,
  vsmWriteDepthFromDeviceZ,
} from './constants.ts'
import {
  VSM_PROJECTION_HEADER_WORDS,
  VSM_PROJECTION_LIGHT_WORD,
  VSM_PROJECTION_LIGHT_WORDS,
  VSM_PROJECTION_MAX_PASS_LIGHTS,
  VSM_PROJECTION_VIEW_BYTES,
  VSM_PROJECTION_VIEW_WORD,
} from './projectionView.ts'
import {
  VSM_PROJECTION_BINDING,
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_RECEIVER_GROUP,
  VSM_PROJECTION_TILE_FORMAT,
  VSM_PROJECTION_VSM_SPECS,
  vsmProjectionGroups,
  vsmProjectionWgsl,
} from './projectionWgsl.ts'
import {
  VSM_PROJECTION_KINDS_DIRECTIONAL,
  VSM_PROJECTION_KINDS_LOCAL,
} from './receiverTraceWgsl.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmPerFrameSet,
  type VsmPerFrameSet,
  vsmFrameSetHeld,
  type VsmResources,
} from './resources.ts'
import { poolWindowSizes, type VsmLayout } from './layout.ts'
import { VSM_PASS_PREFIX } from '../stage/passLabels.ts'

/** The camera the pixels are reconstructed with. */
interface VsmProjectionCamera {
  /** World → view of this engine (column-major, −Z forward), e.g. `CameraFrame.view`. */
  view: ArrayLike<number>
  /** View → clip of this engine (reverse-Z, WebGPU depth range). */
  projection: ArrayLike<number>
  /** The camera's kind as the engine set it (`EngineCamera.perspective`), never read back from a
   *  matrix: an orthographic box of any size takes the orthographic path. */
  perspective: boolean
  /** The origin shift (double); default −camera position. Must be the one the
   *  projection data's `originShift` is relative to (the map view's). */
  originShift?: ArrayLike<number>
}

interface VsmProjectionInputs {
  device: GPUDevice
  /** Scene depth (depth32float, reverse-Z), normals (`normalRough`, xyz = world normal) and the
   *  surface flags of the visibility buffer, all `width` × `height`. */
  depth: GPUTextureView
  normalRough: GPUTextureView
  flags: GPUTextureView
  /** The depth pyramid of the image (`GpuHiz.depth`, its nearest layer built): the screen ray
   *  marches it (`gpu/hiz/screenMarch.ts`). */
  hizDepth: HizDepth
  width: number
  height: number
  camera: VsmProjectionCamera
  /** The state frame index: drives the blue noise in time. */
  frameIndex: number
  /** Force the vote variant; default `vsmProjectionCanUseSubgroups(device)`. */
  subgroups?: boolean
  /** The engine's mask (`vsmEncode.ts`): its 2-D array (`VSM_PROJECTION_MASK_FORMAT`, a layer per
   *  four lights at least) and its tile words (`VSM_PROJECTION_TILE_FORMAT`, a texel per group at
   *  least), both storage bindings, the size of the textures the view is drawn in (dynamic
   *  resolution draws below it, in their top-left) and its eighth. */
  mask: GPUTextureView
  maskTiles: GPUTextureView
  /** The engine's shadow receiver target, the resolve's (`receiverTargetWgsl.ts`): given, each pixel
   *  is projected from its point on the surface its vertex normals describe; absent, its triangle's. */
  receiver?: GPUTextureView
}

/** What every light of the pass holds. */
interface VsmProjectionLightCommon {
  /** The light's VSM id: first clipmap level (directional), the map (spot) or face 0 (point, rect). */
  mapId: number
  /** Direction the light travels (directional), the cone axis (spot), the emitting face normal
   *  (rect). Unit vector, world. Turned into the direction towards the light. */
  direction: ArrayLike<number>
  /** The source's size: its radius in metres for a local light, the sine of its angular radius
   *  for a directional one; absent, a point source. */
  sourceRadius?: number
}

/** Where a local light stands and how far it reaches. */
interface VsmProjectionReach {
  /** World position (double). */
  position: ArrayLike<number>
  /** The light's range (m), the lighting's (`localLightReaches`): it lights nothing past it. */
  radius: number
}

/** One light of the pass (its shader parameters and its virtual shadow map id): a sun, which
 *  reaches every point; a point or a rectangle; a spot, which holds its cone. */
export type VsmProjectionLight = VsmProjectionLightCommon &
  (
    | { type: 'directional' }
    | ({ type: 'point' | 'rect' } & VsmProjectionReach)
    | ({
        type: 'spot'
        /** The cone's half-angle (radians), `SceneLight.coneAngle`. */
        coneAngle: number
      } & VsmProjectionReach)
  )

type VsmProjectionLightType = VsmProjectionLight['type']

/** Whether the projection votes by subgroup (`voteWgsl`): exact at any subgroup size, the workgroup
 *  counter taking over in a group where a half spans several subgroups — always, where the adapter
 *  says its subgroups are under 32 lanes, which the plain variant counts at less cost. */
export const vsmProjectionCanUseSubgroups = (device: GPUDevice) => hasSubgroups(device, 32)

const KIND: Record<VsmProjectionLightType, number> = {
  directional: VSM_LIGHT_KIND_DIRECTIONAL,
  point: VSM_LIGHT_KIND_POINT,
  spot: VSM_LIGHT_KIND_SPOT,
  rect: VSM_LIGHT_KIND_RECT,
}

const scratch = {
  view: new Float64Array(16),
  shiftedToView: new Float64Array(16),
  viewToClip: new Float64Array(16),
  shiftedToClip: new Float64Array(16),
  clipToShifted: new Float64Array(16),
  viewInverse: new Float64Array(16),
  shift: new Float64Array(3),
  /** The shift negated: the point `T(originShift)` takes to the world origin. */
  origin: new Float64Array(3),
}

/** The words of a view uniform's staging image, as floats, unsigned and signed integers. */
interface ViewWords {
  f: Float32Array
  u: Uint32Array
  i: Int32Array
}

/** A light's position where it has none (a sun). */
const ORIGIN = [0, 0, 0] as const

/** What the view's header is written from (`VsmProjectionInputs`). */
type ViewInputs = Pick<VsmProjectionInputs, 'width' | 'height' | 'camera' | 'frameIndex'>

/** The view's matrices into `scratch`: its inverse — the eye its translation (words 12-14) —, the
 *  origin shift, and the shifted-to-view, view-to-clip, shifted-to-clip matrices and its inverse. */
function viewMatrices(camera: ViewInputs['camera']) {
  const s = scratch
  copyMatrix4(s.view, camera.view)
  invertMatrix4(s.viewInverse, s.view)
  // The eye: the inverse view's translation (words 12-14).
  const eye = s.viewInverse,
    shift = s.shift
  for (let k = 0; k < 3; k++) {
    shift[k] = camera.originShift ? camera.originShift[k] : -eye[12 + k]
    s.origin[k] = -shift[k]
  }
  // shiftedToView = flipZ · view · T(originShift): the view at the render origin −shift, its z row
  // negated.
  matrixAtRenderOrigin(s.shiftedToView, s.view, s.origin)
  negateRowMatrix4(s.shiftedToView, s.shiftedToView, 2)
  // viewToClip = projection · flipZ: its z column negated.
  negateColumnMatrix4(s.viewToClip, camera.projection, 2)
  multiplyMatrix4(s.shiftedToClip, s.viewToClip, s.shiftedToView)
  invertMatrix4(s.clipToShifted, s.shiftedToClip)
}

/** The view's header from the matrices of `scratch` (`viewMatrices`), its light `count` included,
 *  the screen's words after it (`writeScreenWords`). */
function writeViewHeader(view: ViewWords, inputs: ViewInputs, count: number) {
  const { f, u } = view,
    s = scratch,
    eye = s.viewInverse,
    shift = s.shift
  f.set(s.shiftedToClip, VSM_PROJECTION_VIEW_WORD.shiftedToClip)
  f.set(s.shiftedToView, VSM_PROJECTION_VIEW_WORD.shiftedToView)
  f.set(s.viewToClip, VSM_PROJECTION_VIEW_WORD.viewToClip)
  f.set(s.clipToShifted, VSM_PROJECTION_VIEW_WORD.clipToShifted)
  for (let k = 0; k < 3; k++)
    writeSplitDouble(
      f,
      VSM_PROJECTION_VIEW_WORD.originShiftHigh + k,
      VSM_PROJECTION_VIEW_WORD.originShiftLow + k,
      shift[k],
    )
  u[VSM_PROJECTION_VIEW_WORD.frameIndex] = inputs.frameIndex >>> 0
  // The camera's kind as the engine knows it, never a matrix test M[3][3] < 1: the projection's
  // jitter (`taaRenderProjection`) leaves rows 2 and 3 as they are, but the same projection
  // scaled as a homogeneous matrix (×0.25: M[3][3] = 0.25 for an orthographic one) would fail it.
  const perspective = inputs.camera.perspective
  u[VSM_PROJECTION_VIEW_WORD.isOrtho] = perspective ? 0 : 1
  for (let k = 0; k < 3; k++) f[VSM_PROJECTION_VIEW_WORD.shiftedEye + k] = eye[12 + k] + shift[k]
  u[VSM_PROJECTION_VIEW_WORD.lightCount] = count
  // The view's forward axis: its +Z (row 2 of shiftedToView).
  f[VSM_PROJECTION_VIEW_WORD.viewForward] = s.shiftedToView[2]
  f[VSM_PROJECTION_VIEW_WORD.viewForward + 1] = s.shiftedToView[6]
  f[VSM_PROJECTION_VIEW_WORD.viewForward + 2] = s.shiftedToView[10]
  vsmWriteDepthFromDeviceZ(f, VSM_PROJECTION_VIEW_WORD.depthFromDeviceZ, s.viewToClip, perspective)
  writeScreenWords(view, inputs, s.viewToClip, perspective)
}

/** The header's screen words (`screenRayScale` on) from view-to-clip `v2c`. */
function writeScreenWords(
  { f, i }: ViewWords,
  { width, height }: ViewInputs,
  v2c: Float64Array,
  perspective: boolean,
) {
  // The screen ray length multiplier (zero but where set) and the tangent and inverse tangent of
  // the half field of view (clip-to-view [0][0], [1][1], view-to-clip [0][0], [1][1]); an
  // orthographic view's are 1.
  const ray = VSM_PROJECTION_VIEW_WORD.screenRayScale,
    tangents = VSM_PROJECTION_VIEW_WORD.halfFovTangents
  if (perspective) {
    f[ray] = f[tangents] = 1 / v2c[0]
    f[ray + 1] = f[tangents + 1] = 1 / v2c[5]
    f[tangents + 2] = v2c[0]
    f[tangents + 3] = v2c[5]
  } else
    f[ray + 2] = f[ray + 3] = f[tangents] = f[tangents + 1] = f[tangents + 2] = f[tangents + 3] = 1
  const pixels = VSM_PROJECTION_VIEW_WORD.viewPixels
  f[pixels] = width
  f[pixels + 1] = height
  f[pixels + 2] = 1 / width
  f[pixels + 3] = 1 / height
  // The geometry of the thickness the screen march gives a surface (`screenSlab`), from the view's
  // own matrix: a translation changes neither gradient it reads.
  f.set(screenSlab(scratch.shiftedToClip, height), VSM_PROJECTION_VIEW_WORD.screenSlab)
  // The projection rect: from (0, 0) (zero), its size.
  i[VSM_PROJECTION_VIEW_WORD.projectionRect + 2] = width
  i[VSM_PROJECTION_VIEW_WORD.projectionRect + 3] = height
}

/** One light's record at word `o`, its position shifted by `shift`. */
function writeLightRecord(
  { f, u, i }: ViewWords,
  o: number,
  light: VsmProjectionLight,
  shift: Float64Array,
) {
  const d = light.direction
  const p = light.type === 'directional' ? ORIGIN : light.position
  const L = VSM_PROJECTION_LIGHT_WORD
  for (let k = 0; k < 3; k++) {
    f[o + L.shiftedPosition + k] = p[k] + shift[k]
    // The record's direction points towards the light.
    f[o + L.direction + k] = -d[k]
  }
  f[o + L.radius] = light.type === 'directional' ? 0 : light.radius
  f[o + L.sourceRadius] = light.sourceRadius ?? 0
  // The cone's cosine as the lighting packs it: −2, which no direction's cosine reaches, off a spot.
  f[o + L.cosCone] = light.type === 'spot' ? Math.cos(light.coneAngle) : NO_CONE
  i[o + L.mapId] = light.mapId | 0
  u[o + L.kind] = KIND[light.type]
}

/** Writes `VsmProjectionView` for these inputs and ≤ 64 lights into its staging words: its header
 *  and the lights' records, the shader reading no record past its light count; returns the bytes
 *  written. */
function writeVsmProjectionView(
  view: ViewWords,
  inputs: ViewInputs,
  lights: readonly VsmProjectionLight[],
) {
  const count = Math.min(lights.length, VSM_PROJECTION_MAX_PASS_LIGHTS),
    words = VSM_PROJECTION_HEADER_WORDS + VSM_PROJECTION_LIGHT_WORDS * count
  view.f.fill(0, 0, words)
  viewMatrices(inputs.camera)
  writeViewHeader(view, inputs, count)
  for (let k = 0; k < count; k++)
    writeLightRecord(
      view,
      VSM_PROJECTION_HEADER_WORDS + k * VSM_PROJECTION_LIGHT_WORDS,
      lights[k],
      scratch.shift,
    )
  return 4 * words
}

/** The projection's module and layouts for one layout, vote and receiver variant, and its
 *  pipelines by their constants (`pipelineFor`): the variants share all but their pipeline; the
 *  groups are each set's (`VsmProjectionState`). */
interface Pipelines {
  module: GPUShaderModule
  layout: GPUPipelineLayout
  vsmLayout: GPUBindGroupLayout
  passLayout: GPUBindGroupLayout
  receiverLayout: GPUBindGroupLayout | undefined
  device: GPUDevice
  /** By 2 · VSM_PROJECTION_KINDS + VSM_PROJECTION_ONE_LIGHT, each compiled off the frame; the
   *  pipeline every pass can run (`TWIN`) the prepare step awaits (`vsmProjectionTwin`), every
   *  other started once, when first made: one the device refuses is not asked again, the twin
   *  drawing its pixels for good. */
  variants: PreparedPipelines<number, GPUComputePipeline>
}

/** What a set's projection holds (`vsmProjectionReserve`), freed with the set
 *  (`releaseVsmProjection`): never shared by two sessions on one device. The engine projects once a
 *  frame into its one mask: one view uniform and one pass group. */
export interface VsmProjectionState {
  uniform?: GPUBuffer
  /** Group 0 over the tables of a frame set and the layout (`vsmPerFrameSet`), the two sets in
   *  turn. */
  tables: VsmPerFrameSet<GPUBindGroup>
  /** The pass group over the layout and the frame's views (`passGroupFor`), made again when one
   *  of them moved. */
  pass: WebgpuBindIdentity
  passGroup?: GPUBindGroup
  /** The receiver group over its layout and view (`receiverGroupFor`): one kept, made again when
   *  one of them moved. */
  receiver: WebgpuBindIdentity
  receiverGroup?: GPUBindGroup
  /** The view uniform's image, uploaded each frame, and its words. */
  staging: ArrayBuffer
  words: ViewWords
  /** The set's blue noise (`createVsmBlueNoiseTexture`) and its view. */
  blueNoise?: GPUTexture
  blueNoiseView?: GPUTextureView
}

/** Bytes the projection of `res` holds — its view uniform and blue noise —, which freeing the
 *  set gives back (`releaseVsmProjection`; the pass draws into the engine's mask). */
export const vsmProjectionHeldBytes = (res: VsmResources) => {
  const state = res.projection
  return (
    (state?.uniform ? VSM_PROJECTION_VIEW_BYTES : 0) + (state?.blueNoise ? VSM_BLUE_NOISE_BYTES : 0)
  )
}

/** Bytes the projection of `res` still asks — its view uniform and its blue noise, each where it
 *  holds none —; of a set not made yet, both. */
export const vsmProjectionBytesToMake = (res: VsmResources | undefined) =>
  VSM_PROJECTION_VIEW_BYTES + VSM_BLUE_NOISE_BYTES - (res ? vsmProjectionHeldBytes(res) : 0)

/** Makes the projection view uniform of `res` and its blue noise, where it holds none: before the
 *  frame's lists, so that they never take the room they need. */
export function vsmProjectionReserve(device: GPUDevice, res: VsmResources) {
  const state = projectionState(res)
  state.uniform ??= device.createBuffer({
    label: 'vsm.projection.view',
    size: VSM_PROJECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  if (!state.blueNoise) {
    state.blueNoise = createVsmBlueNoiseTexture(device)
    state.blueNoiseView = state.blueNoise.createView()
  }
  return state
}

/** The view uniform and the blue noise the projection of `res` reads: what a blended surface's and
 *  the water's trace reads too (`vsmTraceFactor`), the same view and noise. None before the set's
 *  first reservation. */
export function vsmProjectionShared(res: VsmResources) {
  const state = res.projection
  return state?.uniform && state.blueNoiseView
    ? { view: state.uniform, noise: state.blueNoiseView }
    : undefined
}

/** Frees what the projection of `res` holds, with the set (`destroyEngineVsm`). */
export function releaseVsmProjection(res: VsmResources) {
  const state = res.projection
  if (!state) return
  res.projection = undefined
  state.uniform?.destroy()
  state.blueNoise?.destroy()
}

function projectionState(res: VsmResources) {
  if (res.projection) return res.projection
  const staging = new ArrayBuffer(VSM_PROJECTION_VIEW_BYTES)
  return (res.projection = {
    staging,
    tables: vsmFrameSetHeld(),
    pass: createWebgpuBindIdentity(),
    receiver: createWebgpuBindIdentity(),
    words: {
      f: new Float32Array(staging),
      u: new Uint32Array(staging),
      i: new Int32Array(staging),
    },
  })
}

/** The projection's pass, and its pipelines. */
export const VSM_PROJECTION_PASS = `${VSM_PASS_PREFIX}projection`

/** The key of the pipeline every pass can run: all kinds, many lights (`pipelineFor`). */
const TWIN = 0

/** The descriptor of the pipeline of `key` (2 · kinds + one light). */
const projectionDescriptor = (
  p: Pick<Pipelines, 'module' | 'layout'>,
  key: number,
): GPUComputePipelineDescriptor => ({
  label: VSM_PROJECTION_PASS,
  layout: p.layout,
  compute: {
    module: p.module,
    entryPoint: 'vsmProjection',
    constants: { VSM_PROJECTION_ONE_LIGHT: key & 1, VSM_PROJECTION_KINDS: key >> 1 },
  },
})

/** The layout of the pass group: the view uniform, the scene's depth, normals and flags, the blue
 *  noise, and the mask and its tiles the pass writes. */
function projectionPassLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    label: 'vsm.projection.pass',
    entries: [
      computeUniformEntry(VSM_PROJECTION_BINDING.view),
      computeTextureEntry(VSM_PROJECTION_BINDING.sceneDepth, 'depth'),
      computeTextureEntry(VSM_PROJECTION_BINDING.normalRough, 'unfilterable-float'),
      computeTextureEntry(VSM_PROJECTION_BINDING.flags, 'uint'),
      computeTextureEntry(VSM_PROJECTION_BINDING.blueNoise, 'unfilterable-float'),
      ...hizDepthEntries(VSM_PROJECTION_BINDING.hizDepth, GPUShaderStage.COMPUTE),
      {
        binding: VSM_PROJECTION_BINDING.shadowMask,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'write-only',
          format: VSM_PROJECTION_MASK_FORMAT,
          viewDimension: '2d-array',
        },
      },
      {
        binding: VSM_PROJECTION_BINDING.shadowMaskTiles,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: VSM_PROJECTION_TILE_FORMAT },
      },
    ],
  })
}

/** What decides a projection's module and layouts: the pool's layout, the votes and the receiver. */
interface ProjectionVariant {
  layout: VsmLayout
  subgroups: boolean
  receiver: boolean
}

/** The projection's module, layouts and pipelines for these variants. */
function makePipelines(
  device: GPUDevice,
  { layout, subgroups, receiver }: ProjectionVariant,
): Pipelines {
  const vsmLayout = device.createBindGroupLayout({
    label: 'vsm.projection.vsm',
    entries: vsmBindGroupLayoutEntries(VSM_PROJECTION_VSM_SPECS, layout, GPUShaderStage.COMPUTE),
  })
  const passLayout = projectionPassLayout(device)
  const module = device.createShaderModule({
    label: `vsm.projection${subgroups ? '.subgroups' : ''}`,
    code: vsmProjectionWgsl(layout, { subgroups, receiver }),
  })
  const receiverLayout = receiver
    ? device.createBindGroupLayout({
        label: 'vsm.projection.receiver',
        entries: [computeTextureEntry(0, 'uint', '2d', GPUShaderStage.COMPUTE)],
      })
    : undefined
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: receiverLayout
      ? [vsmLayout, passLayout, receiverLayout]
      : [vsmLayout, passLayout],
  })
  return {
    device,
    module,
    layout: pipelineLayout,
    vsmLayout,
    passLayout,
    receiverLayout,
    variants: preparedPipelines((key: number) => {
      const variant = preparedComputePipeline(
        device,
        projectionDescriptor({ module, layout: pipelineLayout }, key),
      )
      return key === TWIN ? variant : started(variant)
    }),
  }
}

/** The device's projections, by the variant they were compiled for (`ProjectionVariant`), made
 *  once a device. */
const projections = oncePerDevice((device: GPUDevice) =>
  preparedPipelines(
    (variant: ProjectionVariant) => makePipelines(device, variant),
    ({ layout, subgroups, receiver }) =>
      `${subgroups}|${receiver}|${poolWindowSizes(layout).length}|${layout.poolRowShift}`,
  ),
)

/** The projection of `device` for these variants (`projections`). */
const pipelinesFor = (
  device: GPUDevice,
  layout: VsmLayout,
  subgroups: boolean,
  receiver: boolean,
) => projections(device).of({ layout, subgroups, receiver })

/** Group 0 of `p` over the tables of `res.current` (`vsmPerFrameSet`). */
const tablesGroup = (res: VsmResources, p: Pipelines) =>
  p.device.createBindGroup({
    label: 'vsm.projection.vsm',
    layout: p.vsmLayout,
    entries: vsmBindGroupEntries(res, VSM_PROJECTION_VSM_SPECS),
  })

/** The projection's twin for `layout` with the engine's receiver, at the votes `device` takes:
 *  prepared by the prepare step (`prepareVsmPipelines`). */
export const vsmProjectionTwin = (device: GPUDevice, layout: VsmLayout) =>
  pipelinesFor(device, layout, vsmProjectionCanUseSubgroups(device), true).variants.of(TWIN)

/**
 * The pipeline of `p` for a pass of `lights`: VSM_PROJECTION_ONE_LIGHT for one light, and
 * VSM_PROJECTION_KINDS their kinds. The asked pipeline compiles off the frame while its twin, every
 * kind and any count of lights, serves the pass — the same pixels, each light taking its own kind
 * branch (`projectionKinds.test.ts`). The twin is made at once the first time a layout asks (the
 * frame that grants the maps, whose pool is allocated in that frame, and whose layout no prepare
 * knows): a frame never draws without its projection, and a new light mix never stalls on a
 * compile.
 */
function pipelineFor(p: Pipelines, lights: readonly VsmProjectionLight[]) {
  let kinds = 0
  for (const light of lights)
    kinds |=
      KIND[light.type] === VSM_LIGHT_KIND_DIRECTIONAL
        ? VSM_PROJECTION_KINDS_DIRECTIONAL
        : VSM_PROJECTION_KINDS_LOCAL
  const key = 2 * kinds + (lights.length === 1 ? 1 : 0)
  const twin = p.variants.of(TWIN).get()
  if (key === TWIN) return twin
  // Started off the frame when made, no frame held on it: the twin draws the same pixels meanwhile,
  // and for good where the device refuses it.
  const variant = p.variants.of(key)
  return variant.ready ? variant.get() : twin
}

/** The pass group of `state` over the frame's inputs: made again only when the layout or one of
 *  the views it binds moved (`createWebgpuBindIdentity`). */
function passGroupFor(
  device: GPUDevice,
  state: VsmProjectionState,
  p: Pipelines,
  inputs: VsmProjectionInputs,
) {
  const { next } = state.pass
  next[0] = p.passLayout
  next[1] = inputs.depth
  next[2] = inputs.hizDepth
  next[3] = inputs.normalRough
  next[4] = inputs.flags
  next[5] = inputs.mask
  next[6] = inputs.maskTiles
  if (state.pass.moved())
    state.passGroup = device.createBindGroup({
      label: 'vsm.projection.pass',
      layout: p.passLayout,
      entries: [
        ...namedEntries(VSM_PROJECTION_BINDING, {
          view: { buffer: state.uniform! },
          sceneDepth: inputs.depth,
          normalRough: inputs.normalRough,
          flags: inputs.flags,
          blueNoise: state.blueNoiseView!,
        }),
        ...hizDepthBindEntries(VSM_PROJECTION_BINDING.hizDepth, inputs.hizDepth),
        ...namedEntries(VSM_PROJECTION_BINDING, {
          shadowMask: inputs.mask,
          shadowMaskTiles: inputs.maskTiles,
        }),
      ],
    })
  return state.passGroup!
}

/** The receiver group of `state` over `receiver` on `layout`, made again when one of them moved. */
function receiverGroupFor(
  device: GPUDevice,
  state: VsmProjectionState,
  layout: GPUBindGroupLayout,
  receiver: GPUTextureView,
) {
  const { next } = state.receiver
  next[0] = layout
  next[1] = receiver
  if (state.receiver.moved())
    state.receiverGroup = device.createBindGroup({
      label: 'vsm.projection.receiver',
      layout,
      entries: sequentialEntries([receiver]),
    })
  return state.receiverGroup!
}

/**
 * Projects up to 64 lights in one dispatch into the engine's mask (`inputs.mask`, r32uint, a layer
 * per four lights): lane k % 4 of layer k / 4 is the shadow factor of `lights[k]` as its trace
 * counted it (`vsmMaskCode`), stored only in the 8×8 tiles whose words (`inputs.maskTiles`) hold a
 * light of that layer. Reads `res.current` (page table, projection data, uniforms) and the pool;
 * call after the frame's VSM render and before `res.swapFrames()`. Once a frame: the call writes
 * the set's one view uniform, which a second call in the same frame would overwrite.
 */
export function encodeVirtualShadowProjection(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  inputs: VsmProjectionInputs,
  lights: readonly VsmProjectionLight[],
) {
  if (lights.length > VSM_PROJECTION_MAX_PASS_LIGHTS)
    throw new Error(`VSM projection: at most ${VSM_PROJECTION_MAX_PASS_LIGHTS} lights per pass`)
  const { device, width, height } = inputs
  const state = vsmProjectionReserve(device, res)
  const subgroups = inputs.subgroups ?? vsmProjectionCanUseSubgroups(device)
  const p = pipelinesFor(device, res.layout, subgroups, !!inputs.receiver)

  const bytes = writeVsmProjectionView(state.words, inputs, lights)
  device.queue.writeBuffer(state.uniform!, 0, state.staging, 0, bytes)

  const vsmGroup = vsmPerFrameSet(state.tables, res, tablesGroup, p, p.vsmLayout)
  const passGroup = passGroupFor(device, state, p, inputs)
  const pass = encoder.beginComputePass({ label: VSM_PROJECTION_PASS })
  pass.setPipeline(pipelineFor(p, lights))
  pass.setBindGroup(0, vsmGroup)
  pass.setBindGroup(1, passGroup)
  if (p.receiverLayout && inputs.receiver)
    pass.setBindGroup(
      VSM_PROJECTION_RECEIVER_GROUP,
      receiverGroupFor(device, state, p.receiverLayout, inputs.receiver),
    )
  pass.dispatchWorkgroups(vsmProjectionGroups(width), vsmProjectionGroups(height), 1)
  pass.end()
}
