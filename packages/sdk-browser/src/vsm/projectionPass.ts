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
import { hasSubgroups } from '../gpu/core/subgroups.ts'
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
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
  VSM_PROJECTION_BINDING,
  VSM_PROJECTION_KINDS_DIRECTIONAL,
  VSM_PROJECTION_KINDS_LOCAL,
  VSM_PROJECTION_MASK_FORMAT,
  VSM_PROJECTION_MAX_PASS_LIGHTS,
  VSM_PROJECTION_RECEIVER_GROUP,
  VSM_PROJECTION_TILE_FORMAT,
  VSM_PROJECTION_VIEW_BYTES,
  VSM_PROJECTION_VSM_SPECS,
  vsmProjectionTiles,
  vsmProjectionWgsl,
} from './projectionWgsl.ts'
import {
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmPerFrameSet,
  type VsmFrameBuffers,
  type VsmResources,
} from './resources.ts'
import type { VsmLayout } from './layout.ts'

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
  width: number
  height: number
  /** Size of the textures the view is drawn in, the view rect at their top-left (dynamic
   *  resolution draws below it); default `width` × `height`. */
  bufferWidth?: number
  bufferHeight?: number
  camera: VsmProjectionCamera
  /** The state frame index: drives the blue noise in time. */
  frameIndex: number
  /** Force the vote variant; default `vsmProjectionCanUseSubgroups(device)`. */
  subgroups?: boolean
  /** The engine's mask (`vsmEncode.ts`): its 2-D array (`VSM_PROJECTION_MASK_FORMAT`, a layer per
   *  four lights at least) and its tile words (`VSM_PROJECTION_TILE_FORMAT`, a texel per group at
   *  least), both storage bindings `bufferWidth` × `bufferHeight` and its eighth. */
  mask: GPUTextureView
  maskTiles: GPUTextureView
  /** The engine's shadow receiver target, the resolve's (`receiverTargetWgsl.ts`): given, each pixel
   *  is projected from its point on the surface its vertex normals describe; absent, its triangle's. */
  receiver?: GPUTextureView
}

type VsmProjectionLightType = 'directional' | 'point' | 'spot' | 'rect'

/** One light of the pass (its shader parameters and its virtual shadow map id). */
export interface VsmProjectionLight {
  type: VsmProjectionLightType
  /** The light's VSM id: first clipmap level (directional), the map (spot) or face 0 (point, rect). */
  mapId: number
  /** Direction the light travels (directional), the cone axis (spot), the emitting face normal
   *  (rect). Unit vector, world. Turned into the direction towards the light. */
  direction: ArrayLike<number>
  /** World position (double), local lights. */
  position?: ArrayLike<number>
  /** Attenuation radius (m), local lights; 0 or absent = unbounded. */
  radius?: number
  /** The source's size: its radius in metres for a local light, the sine of its angular radius
   *  for a directional one. */
  sourceRadius?: number
  /** Spot cone half-angles (radians). */
  innerConeAngle?: number
  outerConeAngle?: number
}

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
}

/** The words of a view uniform's staging image, as floats, unsigned and signed integers. */
interface ViewWords {
  f: Float32Array
  u: Uint32Array
  i: Int32Array
}

/** A light's position where it has none (a sun). */
const ORIGIN = [0, 0, 0] as const

/** The view's header and one light's record, in words (`VsmProjectionView`: 416 B, 48 B). */
const HEADER_WORDS = 104,
  LIGHT_WORDS = 12

/** What the view's header is written from (`VsmProjectionInputs`). */
type ViewInputs = Pick<
  VsmProjectionInputs,
  'width' | 'height' | 'bufferWidth' | 'bufferHeight' | 'camera' | 'frameIndex'
>

/** The view's matrices into `scratch`: its inverse — the eye its translation (words 12-14) —, the
 *  origin shift, and the shifted-to-view, view-to-clip, shifted-to-clip matrices and its inverse. */
function viewMatrices(camera: ViewInputs['camera']) {
  const s = scratch
  for (let k = 0; k < 16; k++) s.view[k] = camera.view[k]
  invertMatrix4(s.viewInverse, s.view)
  // The eye: the inverse view's translation (words 12-14).
  const eye = s.viewInverse,
    shift = s.shift
  for (let k = 0; k < 3; k++) shift[k] = camera.originShift ? camera.originShift[k] : -eye[12 + k]
  // shiftedToView = flipZ · view · T(originShift).
  s.shiftedToView.set(s.view)
  for (let r = 0; r < 3; r++)
    s.shiftedToView[12 + r] =
      s.view[12 + r] - (s.view[r] * shift[0] + s.view[4 + r] * shift[1] + s.view[8 + r] * shift[2])
  for (let k = 2; k < 16; k += 4) s.shiftedToView[k] = -s.shiftedToView[k]
  // viewToClip = projection · flipZ.
  for (let k = 0; k < 16; k++) s.viewToClip[k] = camera.projection[k]
  for (let k = 8; k < 12; k++) s.viewToClip[k] = -s.viewToClip[k]
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
  f.set(s.shiftedToClip, 0)
  f.set(s.shiftedToView, 16)
  f.set(s.viewToClip, 32)
  f.set(s.clipToShifted, 48)
  writeSplitDouble(f, 64, 68, shift[0])
  writeSplitDouble(f, 65, 69, shift[1])
  writeSplitDouble(f, 66, 70, shift[2])
  u[67] = inputs.frameIndex >>> 0
  // A matrix test M[3][3] < 1 would tell it from the exact matrix; the engine knows its camera's kind, which a
  // projection rebuilt through the view's inverse (`vsmEncode.ts` rasterProjection) or scaled
  // (an orthographic box's zoom scales M[3][3] with it) no longer tells by its value.
  const perspective = inputs.camera.perspective
  u[71] = perspective ? 0 : 1
  f[72] = eye[12] + shift[0]
  f[73] = eye[13] + shift[1]
  f[74] = eye[14] + shift[2]
  u[75] = count
  // The view's forward axis: its +Z (row 2 of shiftedToView).
  f[76] = s.shiftedToView[2]
  f[77] = s.shiftedToView[6]
  f[78] = s.shiftedToView[10]
  vsmWriteDepthFromDeviceZ(f, 80, s.viewToClip, perspective)
  writeScreenWords(view, inputs, s.viewToClip, perspective)
}

/** The header's screen words (84-103) from view-to-clip `v2c`. */
function writeScreenWords(
  { f, i }: ViewWords,
  { width, height, bufferWidth, bufferHeight }: ViewInputs,
  v2c: Float64Array,
  perspective: boolean,
) {
  // The screen ray length multiplier (words 84-87, zero but where set) and the tangent and inverse
  // tangent of the half field of view (88-91: clip-to-view [0][0], [1][1], view-to-clip [0][0],
  // [1][1]); an orthographic view's are 1.
  if (perspective) {
    f[84] = f[88] = 1 / v2c[0]
    f[85] = f[89] = 1 / v2c[5]
    f[90] = v2c[0]
    f[91] = v2c[5]
  } else f[86] = f[87] = f[88] = f[89] = f[90] = f[91] = 1
  f[92] = width
  f[93] = height
  f[94] = 1 / width
  f[95] = 1 / height
  // The screen position scale and bias: NDC to the UV of the buffer the
  // view rect [0, size) sits in, as the screen ray samples the scene depth.
  const bw = bufferWidth ?? width,
    bh = bufferHeight ?? height
  f[96] = width / bw / 2
  f[97] = -height / bh / 2
  f[98] = height / 2 / bh
  f[99] = width / 2 / bw
  // The projection rect: from (0, 0) (words 100-101, zero), its size.
  i[102] = width
  i[103] = height
}

/** One light's record at word `o`, its position shifted by `shift`. */
function writeLightRecord(
  { f, u, i }: ViewWords,
  o: number,
  light: VsmProjectionLight,
  shift: Float64Array,
) {
  const d = light.direction
  const p = light.position ?? ORIGIN
  f[o] = p[0] + shift[0]
  f[o + 1] = p[1] + shift[1]
  f[o + 2] = p[2] + shift[2]
  f[o + 3] = light.radius && light.radius > 0 ? 1 / light.radius : 0
  // The record's direction points towards the light.
  f[o + 4] = -d[0]
  f[o + 5] = -d[1]
  f[o + 6] = -d[2]
  f[o + 7] = light.sourceRadius ?? 0
  if (light.type === 'spot') {
    // The spot cone: inner clamped below outer, the angles = (cos outer, 1/(cos inner − cos outer)).
    const outer = light.outerConeAngle ?? Math.PI / 4
    const inner = Math.min(Math.max(light.innerConeAngle ?? 0, 0), outer - 0.001)
    const cosOuter = Math.cos(outer)
    f[o + 8] = cosOuter
    f[o + 9] = 1 / (Math.cos(inner) - cosOuter)
  } else {
    f[o + 8] = -2
    f[o + 9] = 1
  }
  i[o + 10] = light.mapId | 0
  u[o + 11] = KIND[light.type]
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
    words = HEADER_WORDS + LIGHT_WORDS * count
  view.f.fill(0, 0, words)
  viewMatrices(inputs.camera)
  writeViewHeader(view, inputs, count)
  for (let k = 0; k < count; k++)
    writeLightRecord(view, HEADER_WORDS + k * LIGHT_WORDS, lights[k], scratch.shift)
  return 4 * words
}

/** The projection's module, layouts and bind groups for one layout, vote and receiver variant, and
 *  its pipelines by their constants (`pipelineFor`): the variants share all but their pipeline. */
interface Pipelines {
  module: GPUShaderModule
  layout: GPUPipelineLayout
  vsmLayout: GPUBindGroupLayout
  passLayout: GPUBindGroupLayout
  receiverLayout: GPUBindGroupLayout | undefined
  device: GPUDevice
  /** Group 0 by frame set (`vsmPerFrameSet`). */
  vsmGroups: WeakMap<VsmFrameBuffers, GPUBindGroup>
  receiverGroups: WeakMap<GPUTextureView, GPUBindGroup>
  /** By 2 · VSM_PROJECTION_KINDS + VSM_PROJECTION_ONE_LIGHT, each compiled off the frame; the
   *  pipeline every pass can run (`TWIN`) the prepare step awaits (`vsmProjectionTwin`). */
  variants: PreparedPipelines<number, GPUComputePipeline>
  /** The variants asked of the device already: each is asked once, so a refused one is not asked
   *  again at every frame — the twin draws its pixels for good. */
  asked: Set<number>
}

/** The pass group and what it binds: made again only when one of them changes. */
interface PassGroup {
  group: GPUBindGroup
  layout: GPUBindGroupLayout
  depth: GPUTextureView
  normalRough: GPUTextureView
  flags: GPUTextureView
  mask: GPUTextureView
  maskTiles: GPUTextureView
}

/** What a set's projection holds (`vsmProjectionReserve`), freed with the set
 *  (`releaseVsmProjection`): never shared by two sessions on one device. The engine projects once a
 *  frame into its one mask: one view uniform and one pass group. */
interface ProjectionState {
  uniform?: GPUBuffer
  group?: PassGroup
  /** The view uniform's image, uploaded each frame, and its words. */
  staging: ArrayBuffer
  words: ViewWords
  /** The set's blue noise (`createVsmBlueNoiseTexture`) and its view. */
  blueNoise?: GPUTexture
  blueNoiseView?: GPUTextureView
}

/** The device's projection pipelines, by the layout and variant they were compiled for. */
const pipelines = new WeakMap<GPUDevice, Map<string, Pipelines>>()
const states = new WeakMap<VsmResources, ProjectionState>()

/** Bytes the projection of `res` holds — its view uniform and blue noise —, which freeing the
 *  set gives back (`releaseVsmProjection`; the pass draws into the engine's mask). */
export const vsmProjectionHeldBytes = (res: VsmResources) => {
  const state = states.get(res)
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

/** Frees what the projection of `res` holds, with the set (`destroyEngineVsm`). */
export function releaseVsmProjection(res: VsmResources) {
  const state = states.get(res)
  if (!state) return
  states.delete(res)
  state.uniform?.destroy()
  state.blueNoise?.destroy()
}

function projectionState(res: VsmResources) {
  let s = states.get(res)
  if (!s) {
    const staging = new ArrayBuffer(VSM_PROJECTION_VIEW_BYTES)
    s = {
      staging,
      words: {
        f: new Float32Array(staging),
        u: new Uint32Array(staging),
        i: new Int32Array(staging),
      },
    }
    states.set(res, s)
  }
  return s
}

/** The key of the pipeline every pass can run: all kinds, many lights (`pipelineFor`). */
const TWIN = 0

/** The descriptor of the pipeline of `key` (2 · kinds + one light). */
const projectionDescriptor = (
  p: Pick<Pipelines, 'module' | 'layout'>,
  key: number,
): GPUComputePipelineDescriptor => ({
  label: 'vsm.projection',
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
  const B = VSM_PROJECTION_BINDING
  return device.createBindGroupLayout({
    label: 'vsm.projection.pass',
    entries: [
      { binding: B.view, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      {
        binding: B.sceneDepth,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'depth' },
      },
      {
        binding: B.normalRough,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'unfilterable-float' },
      },
      { binding: B.flags, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
      {
        binding: B.blueNoise,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'unfilterable-float' },
      },
      {
        binding: B.shadowMask,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          access: 'write-only',
          format: VSM_PROJECTION_MASK_FORMAT,
          viewDimension: '2d-array',
        },
      },
      {
        binding: B.shadowMaskTiles,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: VSM_PROJECTION_TILE_FORMAT },
      },
    ],
  })
}

/** The projection's module, layouts and bind groups for these variants. */
function pipelinesFor(device: GPUDevice, layout: VsmLayout, subgroups: boolean, receiver: boolean) {
  let made = pipelines.get(device)
  if (!made) pipelines.set(device, (made = new Map()))
  const key = `${subgroups}|${receiver}|${layout.poolPartsPerSlice}|${layout.poolPartTexelShift}|${layout.poolTexelsXY[0]}`
  let p = made.get(key)
  if (p) return p
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
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'uint' } },
        ],
      })
    : undefined
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: receiverLayout
      ? [vsmLayout, passLayout, receiverLayout]
      : [vsmLayout, passLayout],
  })
  p = {
    device,
    module,
    layout: pipelineLayout,
    vsmLayout,
    passLayout,
    receiverLayout,
    vsmGroups: new WeakMap(),
    receiverGroups: new WeakMap(),
    asked: new Set(),
    variants: preparedPipelines((key: number) =>
      preparedComputePipeline(
        device,
        projectionDescriptor({ module, layout: pipelineLayout }, key),
      ),
    ),
  }
  made.set(key, p)
  return p
}

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
 * VSM_PROJECTION_KINDS their kinds. The asked
 * pipeline compiles off the frame while its twin, every kind and any count of lights, serves the
 * pass — the same pixels, each light taking its own kind branch (`projectionKinds.test.ts`). The
 * twin is made at once the first time a layout asks (the frame that grants the maps, whose pool is
 * allocated in that frame, and whose layout no prepare knows): a frame never draws without its
 * projection, and a new light mix never stalls on a compile.
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
  // Asked off the frame once, no frame held on it: the twin draws the same pixels meanwhile, and
  // for good where the device refuses it.
  const variant = p.variants.of(key)
  if (!p.asked.has(key)) {
    p.asked.add(key)
    started(variant)
  }
  return variant.ready ? variant.get() : twin
}

/** The pass group of `state` over the frame's inputs: made again only when the layout or one of
 *  the views it binds changes. */
function passGroupFor(
  device: GPUDevice,
  state: ProjectionState,
  p: Pipelines,
  inputs: VsmProjectionInputs,
) {
  const { mask, maskTiles } = inputs
  let passGroup = state.group
  if (
    !passGroup ||
    passGroup.layout !== p.passLayout ||
    passGroup.depth !== inputs.depth ||
    passGroup.normalRough !== inputs.normalRough ||
    passGroup.flags !== inputs.flags ||
    passGroup.mask !== mask ||
    passGroup.maskTiles !== maskTiles
  ) {
    const B = VSM_PROJECTION_BINDING
    state.group = passGroup = {
      group: device.createBindGroup({
        label: 'vsm.projection.pass',
        layout: p.passLayout,
        entries: [
          { binding: B.view, resource: { buffer: state.uniform! } },
          { binding: B.sceneDepth, resource: inputs.depth },
          { binding: B.normalRough, resource: inputs.normalRough },
          { binding: B.flags, resource: inputs.flags },
          { binding: B.blueNoise, resource: state.blueNoiseView! },
          { binding: B.shadowMask, resource: mask },
          { binding: B.shadowMaskTiles, resource: maskTiles },
        ],
      }),
      layout: p.passLayout,
      depth: inputs.depth,
      normalRough: inputs.normalRough,
      flags: inputs.flags,
      mask,
      maskTiles,
    }
  }
  return passGroup
}

/** The receiver group of `p` over `receiver`, made once a view. */
function receiverGroupFor(p: Pipelines, layout: GPUBindGroupLayout, receiver: GPUTextureView) {
  let group = p.receiverGroups.get(receiver)
  if (!group) {
    group = p.device.createBindGroup({
      label: 'vsm.projection.receiver',
      layout,
      entries: [{ binding: 0, resource: receiver }],
    })
    p.receiverGroups.set(receiver, group)
  }
  return group
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

  const vsmGroup = vsmPerFrameSet(p.vsmGroups, res, tablesGroup, p)
  const passGroup = passGroupFor(device, state, p, inputs)
  const pass = encoder.beginComputePass({ label: 'vsm.projection' })
  pass.setPipeline(pipelineFor(p, lights))
  pass.setBindGroup(0, vsmGroup)
  pass.setBindGroup(1, passGroup.group)
  if (p.receiverLayout && inputs.receiver)
    pass.setBindGroup(
      VSM_PROJECTION_RECEIVER_GROUP,
      receiverGroupFor(p, p.receiverLayout, inputs.receiver),
    )
  pass.dispatchWorkgroups(...vsmProjectionTiles(width, height))
  pass.end()
}
