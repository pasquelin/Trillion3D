import { readHairStrandsSetting } from '../../../sdk-core/src/contracts/hairStrandsOptions.ts'
import { alignUp, ceilDiv } from '../../../math/src/scalar/integers.ts'
import { ensureSet, type HeldSet } from '../gpu/core/heldTextures.ts'
import { ComputeRun } from '../gpu/core/lazyComputePass.ts'
import type { ResourceAllocator } from '../gpu/core/resourceAllocator.ts'
import { wordViews } from '../gpu/core/wordViews.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { noiseViewOn } from '../gpu/noise/blueNoiseTextures.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { chainReady } from '../lighting/deferred/fullscreen.ts'
import { frameLights } from '../lighting/shadows/vsm/frame/vsmPlan.ts'
import { vsmHairMasks } from '../lighting/shadows/vsm/projection/hairProjectionPass.ts'
import { lightingPhase } from '../lighting/surfaceCache/lighting/phase.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'
import { HAIR_NODE_GROUP_SIZE } from './visibilityMath.ts'
import { deepShadowIndexOf, strandLightOf, type HairDeepShadowLight } from './deepShadowMath.ts'
import {
  deepShadowMaskBinds,
  deepShadowPipelines,
  encodeDeepShadowMask,
  type DeepShadowMaskTarget,
  type HairDeepShadows,
} from './deepShadowPass.ts'
import {
  HAIR_LIGHT_FORMAT,
  encodeHairLight,
  hairLightGroup,
  hairLightLayout,
  hairLutSampler,
  hairLightPipeline,
  hairLightSide,
  hairSkyPipeline,
} from './hairLightPass.ts'
import { HAIR_LIGHT_NO_SLOT, HAIR_LIGHT_PARAM_WORDS } from './hairLightWgsl.ts'
import { encodeSampledHair, sampledHairReady } from '../lighting/manyLightsSampled/hairFrame.ts'
import {
  encodeHairEnvironment,
  encodeHairStaticLight,
  type HairEnvironment,
} from './environment.ts'
import type { HairNodes } from './compactionPass.ts'
import type { HairFrameInputs } from './inputs.ts'
import type { HairViewGpu } from './viewGpu.ts'
import { HAIR_COMPOSE_IMAGE_WORDS } from './compositionWgsl.ts'
import {
  encodeHairComposition,
  hairComposeBinds,
  hairComposePipeline,
  type HairComposeSources,
} from './compositionPass.ts'
import {
  encodeVoxelTransmittance,
  voxelTransmittanceBinds,
  voxelTransmittancePipeline,
  writeTransmittanceLight,
  type VoxelTransmittanceTarget,
} from './voxelTransmittancePass.ts'

/** The words of a voxel transmittance's light block (`TransmittanceLight`). */
const LIGHT_BLOCK_WORDS = 12
/** The ranks of lights the table of slots has room for, a multiple of this. */
const RANK_STEP = 16
/** The slots a batch of lights is made with, a multiple of this. */
const SLOT_STEP = 4

/** The shadow masks of a frame whose strands have none. */
const NO_MASKS = { suns: undefined, locals: undefined }
const velocityRun = new ComputeRun()
const PASS = `${HAIR_STRANDS_PASS_PREFIX}light transmittance`
const PASS_DESCRIPTOR: GPUComputePassDescriptor = { label: PASS }

/** The masks of one batch of lights, one after the other (`stride` words a light), the slot of each light by its rank, the
 *  parameters of each batch's pass, a block of each traced light, the image block of the composition and the grid the samples
 *  are lit on. */
function allocateLighting(
  allocator: ResourceAllocator,
  stride: number,
  perBatch: number,
  lights: number,
  batches: number,
  ranks: number,
  side: number,
) {
  const attached = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  return {
    masks: allocator.buffer('masks', stride * perBatch, 'storage'),
    slotTable: allocator.buffer('slots', ranks, 'storage'),
    params: Array.from({ length: batches }, (_, k) =>
      allocator.buffer(`parameters ${k}`, HAIR_LIGHT_PARAM_WORDS, 'uniform'),
    ),
    blocks: Array.from({ length: lights }, (_, k) =>
      allocator.buffer(`light block ${k}`, LIGHT_BLOCK_WORDS, 'uniform'),
    ),
    image: allocator.buffer('image', HAIR_COMPOSE_IMAGE_WORDS, 'uniform'),
    grid: allocator.texture('light', [side, side], HAIR_LIGHT_FORMAT, { usage: attached }),
  }
}

/** What a set adds to its buffers, made with it. */
interface LightingExtra {
  readonly stride: number
  /** The lights whose masks one batch holds; a batch is lit by a pass of its own. */
  readonly perBatch: number
  readonly lights: number
  readonly batches: number
  readonly ranks: number
  readonly side: number
  /** The targets and the bind groups of each light's tracing (by its place in the traced lights), made as the passes first need them. */
  readonly voxelTargets: (VoxelTransmittanceTarget | undefined)[]
  readonly voxelBinds: ReturnType<typeof voxelTransmittanceBinds>[]
  readonly deepTargets: (DeepShadowMaskTarget | undefined)[]
  readonly deepBinds: ReturnType<typeof deepShadowMaskBinds>[]
  readonly table: Uint32Array<ArrayBuffer>
  readonly paramWords: ReturnType<typeof wordViews>
  readonly blockWords: ReturnType<typeof wordViews>
  readonly imageWords: ReturnType<typeof wordViews>
  readonly composeBinds: ReturnType<typeof hairComposeBinds>
  /** The group 1 of each batch's light pass, kept while the samples and the table it names stay. */
  groups: (
    | {
        nodes: object
        lut: GPUTextureView
        scene: GPUTextureView
        env: GPUTextureView
        draws: GPUBuffer | undefined
        made: GPUBindGroup
      }
    | undefined
  )[]
  /** What the composition reads, kept while the views it names stay. */
  sources?: HairComposeSources
  /** Whether the image's strands are lit and wait to be laid on the image (`composeHairStrands`). */
  lit: boolean
}

/** The lighting of the strands of a view, kept with it (`HairViewGpu.lighting`) and grown only. */
export type HairLighting = ReturnType<typeof allocateLighting> & LightingExtra & HeldSet

/** A light whose transmittance is traced through the strands, and the deep shadow that gives it, where it draws one. */
interface Tracing {
  readonly rank: number
  readonly light: HairDeepShadowLight
  readonly deepOffset: number | undefined
}

/** The sizes of the light of the strands: what a set is made for (`ensureHairLightingSet`). */
interface LightingSizes {
  readonly stride: number
  readonly perBatch: number
  readonly lights: number
  readonly batches: number
  readonly ranks: number
  readonly side: number
  /** The batch size the device's binding limit allows. */
  readonly room: number
  /** The lights traced. */
  readonly count: number
}

/** The view's lighting set for `sizes`: the one it holds where it fits, else made; none, said, where the device has no room. */
function ensureHairLightingSet(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  view: HairViewGpu,
  { stride, perBatch, lights, batches, ranks, side, room, count }: LightingSizes,
) {
  const made = ensureSet<ReturnType<typeof allocateLighting>, LightingExtra>(
    view.lighting,
    device,
    {
      key: [stride, perBatch, lights, batches, ranks, side],
      what: 'the light of the hair strands',
      label: `${HAIR_STRANDS_PASS_PREFIX}light`,
      fits: (held) =>
        held.stride === stride &&
        held.side === side &&
        held.ranks >= ranks &&
        held.lights >= lights &&
        held.perBatch <= room &&
        held.batches >= ceilDiv(Math.max(count, 1), held.perBatch),
    },
    (allocator) => allocateLighting(allocator, stride, perBatch, lights, batches, ranks, side),
    () => ({
      stride,
      perBatch,
      lights,
      batches,
      ranks,
      side,
      voxelTargets: [],
      voxelBinds: [],
      deepTargets: [],
      deepBinds: [],
      table: new Uint32Array(ranks),
      paramWords: wordViews(new ArrayBuffer(HAIR_LIGHT_PARAM_WORDS * 4)),
      blockWords: wordViews(new ArrayBuffer(LIGHT_BLOCK_WORDS * 4)),
      imageWords: wordViews(new ArrayBuffer(HAIR_COMPOSE_IMAGE_WORDS * 4)),
      composeBinds: hairComposeBinds(),
      groups: [],
      lit: false,
    }),
  )
  if (!made.resources) {
    rt.diag.diagnosticFailure(
      'hair-strands-light-failed',
      new Error(`the light of the hair strands cannot be made: ${made.why ?? 'no room'}`),
    )
    return undefined
  }
  return (view.lighting = made.resources)
}

/** What a batch of the strands' light reads: the image's, the traced lights and the pipelines (`encodeHairLighting`). */
interface BatchFrame {
  readonly rt: WebgpuPagesRuntime
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  readonly view: HairViewGpu
  readonly set: HairLighting
  readonly traced: readonly Tracing[]
  readonly nodes: HairNodes
  readonly stride: number
  readonly side: number
  readonly inputs: HairFrameInputs
  draws: ReturnType<typeof encodeSampledHair> | undefined
  readonly environment: HairEnvironment
  readonly scene: GPUTextureView
  readonly lutView: GPUTextureView
  readonly noise: GPUTextureView
  readonly phase: number
  readonly voxelPipeline: ReturnType<typeof voxelTransmittancePipeline>
  readonly deepPipeline: GPUComputePipeline | undefined
  readonly lightGroup: GPUBindGroup
  readonly light: ReturnType<typeof hairLightPipeline>
}

/** The deep shadow's mask of the traced light `at`, into the batch's pass. */
function encodeDeepMask(
  { device, view, set, nodes, stride, deepPipeline }: BatchFrame,
  pass: GPUComputePassEncoder,
  at: number,
  deepOffset: number,
  maskOffset: number,
) {
  if (!deepPipeline) return
  let target = set.deepTargets[at]
  if (
    target?.offset !== deepOffset ||
    target.maskOffset !== maskOffset ||
    target.viewBuffer !== view.viewBlock.buffer
  )
    target = set.deepTargets[at] = {
      mask: set.masks,
      maskOffset,
      maskSize: stride * 4,
      viewBuffer: view.viewBlock.buffer,
      offset: deepOffset,
    }
  encodeDeepShadowMask(
    device,
    pass,
    deepPipeline,
    (set.deepBinds[at] ??= deepShadowMaskBinds()),
    view.deepShadows!,
    nodes,
    target,
  )
}

/** The voxels' mask of the traced light `at`, into the batch's pass. */
function encodeVoxelMask(
  { device, view, set, nodes, stride, inputs, noise, phase, voxelPipeline }: BatchFrame,
  pass: GPUComputePassEncoder,
  at: number,
  source: HairDeepShadowLight,
  maskOffset: number,
) {
  if (!voxelPipeline) return
  let target = set.voxelTargets[at]
  if (
    target?.noise !== noise ||
    target.maskOffset !== maskOffset ||
    target.viewBuffer !== view.viewBlock.buffer
  )
    target = set.voxelTargets[at] = {
      mask: set.masks,
      maskOffset,
      maskSize: stride * 4,
      light: set.blocks[at]!,
      viewBuffer: view.viewBlock.buffer,
      noise,
    }
  writeTransmittanceLight(set.blockWords, inputs.voxel!, source, phase)
  device.queue.writeBuffer(set.blocks[at]!, 0, set.blockWords.u)
  encodeVoxelTransmittance(
    device,
    pass,
    voxelPipeline,
    (set.voxelBinds[at] ??= voxelTransmittanceBinds()),
    view.voxel.set!,
    nodes,
    target,
  )
}

/** The transmittance toward the lights of `batch`, a mask a sample: the masks of one batch after the other. */
function encodeBatchMasks(frame: BatchFrame, batch: number) {
  const { encoder, set, traced, stride } = frame
  const first = batch * set.perBatch
  const end = Math.min(traced.length, first + set.perBatch)
  if (end <= first) return
  const pass = encoder.beginComputePass(PASS_DESCRIPTOR)
  for (let at = first; at < end; at++) {
    const { light, deepOffset } = traced[at]!
    const maskOffset = (at - first) * stride * 4
    if (deepOffset !== undefined) encodeDeepMask(frame, pass, at, deepOffset, maskOffset)
    else encodeVoxelMask(frame, pass, at, light, maskOffset)
  }
  pass.end()
}

/** The parameters of the light pass of `batch`. */
function writeLightParams(
  { device, set, stride, side, inputs, draws, environment }: BatchFrame,
  batch: number,
) {
  set.paramWords.u[0] = stride
  set.paramWords.u[1] = inputs.components ?? 0
  set.paramWords.u[2] = side
  set.paramWords.u[3] = inputs.scatterSceneLighting ? 1 : 0
  set.paramWords.u[4] = batch
  set.paramWords.u[5] = set.perBatch
  set.paramWords.u[6] = environment.ran ? 1 : environment.staticLit ? 2 : 0
  set.paramWords.u[7] = draws?.word ?? 0
  writeChanged(device, set.params[batch]!, set.paramWords.u, 0, HAIR_LIGHT_PARAM_WORDS)
}

/** The light of every sample for the lights of `batch`; the lights that have no mask are lit by the first. */
function encodeBatchLight(frame: BatchFrame, batch: number) {
  const { device, encoder, set, nodes, lutView, lightGroup, light, environment, scene, draws } =
    frame
  writeLightParams(frame, batch)
  let held = set.groups[batch]
  if (
    held?.nodes !== nodes ||
    held.lut !== lutView ||
    held.scene !== scene ||
    held.env !== environment.grid ||
    held.draws !== draws?.draws
  )
    held = set.groups[batch] = {
      nodes,
      lut: lutView,
      scene: scene,
      env: environment.grid,
      draws: draws?.draws,
      made: hairLightGroup(device, hairLightLayout(device), {
        nodes,
        masks: set.masks,
        slots: set.slotTable,
        params: set.params[batch]!,
        lut: lutView,
        scene: scene,
        env: environment.grid,
        draws: draws?.draws,
      }),
    }
  encodeHairLight(
    encoder,
    (batch ? light.next : light.first).get()!,
    lightGroup,
    held.made,
    set.grid,
    batch > 0,
  )
}

/** The slot of each traced light by its rank: its place in the traced lights, the batch it is lit in and its place in the batch from it. */
function writeSlotTable(device: GPUDevice, set: HairLighting, traced: readonly Tracing[]) {
  set.table.fill(HAIR_LIGHT_NO_SLOT)
  traced.forEach(({ rank }, at) => (set.table[rank] = at))
  writeChanged(device, set.slotTable, set.table, 0, set.ranks)
}

/** The sizes of the light of `count` traced lights over `nodes`; none where the device's binding cannot hold one mask. */
function lightingSizesOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  nodes: HairNodes,
  count: number,
): LightingSizes | undefined {
  const stride = alignUp(nodes.capacity, HAIR_NODE_GROUP_SIZE)
  const room = Math.floor(device.limits.maxStorageBufferBindingSize / (stride * 4))
  if (room < 1) return undefined
  const lights = alignUp(Math.max(count, 1), SLOT_STEP)
  const perBatch = Math.min(lights, room)
  return {
    stride,
    perBatch,
    lights,
    batches: ceilDiv(Math.max(count, 1), perBatch),
    ranks: alignUp(Math.max(rt.lights.store.count, 1), RANK_STEP),
    side: hairLightSide(nodes.capacity),
    room,
    count,
  }
}

/** What the light of the strands needs this image: its view and the resources and pipelines of the lighting; none (the light of the image marked not lit) while one is missing or a pipeline compiles. */
function hairLightingReady(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu } = rt
  const view = gpu.hair
  const record = view?.record
  const program = gpu.deferred?.litProgram
  const fog = gpu.deferred?.fogBinding()
  if (view?.lighting) view.lighting.lit = false
  if (
    !view?.visible ||
    !view.lut ||
    !view.environment ||
    !record ||
    !program ||
    !fog ||
    !gpu.hdrView
  )
    return undefined
  const lit = program.hair
  // The lights of the strands' samples drawn by the sampled lighting (`sampledLightsHairStrands`), where its passes are compiled.
  const sampled = sampledHairReady(
    rt,
    device,
    view.voxel.set && view.inputs.voxel ? view.inputs.voxel : undefined,
  )
  const light = hairLightPipeline(device, lit.layout, lit.key, lit.label, sampled)
  const sky = hairSkyPipeline(device, lit.skyLayout, lit.cubed, lit.label)
  const compose = hairComposePipeline(device, fog.layout, fog.localFog)
  if (!chainReady(light.first, light.next, sky, compose)) return undefined
  return {
    view,
    program,
    light,
    sky,
    nodes: record.nodes,
    sampled,
    scene: gpu.hdrView,
    environment: view.environment,
    lut: view.lut,
  }
}

/** What the batches of the strands' light share: the pipelines of the masks, the light's group and the image's resources; none while the light's group is not made. The sampled lights' draws are set after the environment is encoded. */
function batchFrameOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  ready: NonNullable<ReturnType<typeof hairLightingReady>>,
  set: HairLighting,
  traced: readonly Tracing[],
  { stride, side }: LightingSizes,
  voxelized: boolean,
): BatchFrame | undefined {
  const { view, program, light, nodes, scene, environment, lut } = ready
  const { inputs } = view
  const vsmMasks = rt.lights.vsm && vsmHairMasks(rt.lights.vsm.res)
  const lightGroup = program.hairGroup(vsmMasks ?? NO_MASKS)
  if (!lightGroup) return undefined
  return {
    rt,
    device,
    encoder,
    view,
    set,
    traced,
    nodes,
    stride,
    side,
    inputs,
    draws: undefined,
    lutView: lut.view,
    noise: noiseViewOn(device),
    phase: lightingPhase(rt),
    voxelPipeline: voxelized ? voxelTransmittancePipeline(device, inputs.voxel!) : undefined,
    deepPipeline: view.deepShadows ? deepShadowPipelines(device)?.mask : undefined,
    lightGroup,
    light,
    environment,
    scene,
  }
}

/** The lights of the strands' samples drawn by the sampled lighting, where its passes are compiled. */
function encodeSampledDraws(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  { view, nodes, inputs, lutView }: BatchFrame,
  sampled: boolean,
  voxelized: boolean,
) {
  if (!sampled) return undefined
  return encodeSampledHair(
    rt,
    device,
    encoder,
    nodes,
    view.viewBlock.buffer,
    cam.eye,
    voxelized ? { set: view.voxel.set!, settings: inputs.voxel! } : undefined,
    { lut: lutView, sampler: hairLutSampler(device), components: inputs.components ?? 0 },
  )
}

/**
 * THE STRANDS LIT, once the surfaces are: the transmittance toward each light that casts a shadow through the strands (the
 * deep shadow of a light that draws one, else the voxels), a mask a sample; then the light of every compacted sample on a
 * square grid, the lights of its cell and then the sky's. The masks of a batch of lights, as many as one buffer binding holds,
 * are lit by a pass, the next batch by the next, added to it, as the reference lights each shadowed light by a pass of its own.
 * The strands are laid on the image later (`composeHairStrands`). Nothing is drawn while the image holds no strands, the table of
 * the fibre is not made or a pipeline compiles (the frames wait for it).
 */
export function encodeHairLighting(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const ready = hairLightingReady(rt, device)
  if (!ready) return
  const { view, program, light, sky, nodes, sampled, scene, environment, lut } = ready
  const skyGroup = program.hairSkyGroup()
  const { inputs } = view

  const voxelized = !!(view.voxel.set && inputs.voxel)
  const traced = tracedLights(rt, cam, view.deepShadows, voxelized, sampled)
  const sizes = lightingSizesOf(rt, device, nodes, traced.length)
  if (!sizes) return
  const { stride, side } = sizes
  const set = ensureHairLightingSet(rt, device, view, sizes)
  if (!set) return

  writeSlotTable(device, set, traced)

  const frame = batchFrameOf(rt, device, encoder, cam, ready, set, traced, sizes, voxelized)
  if (!frame || !skyGroup) return
  // Where no probe lit the strands from the cache, the integrations that trace the voxels gather the sky light.
  encodeHairEnvironment(rt, device, encoder, view)
  encodeHairStaticLight(rt, device, encoder, view)
  frame.draws = encodeSampledDraws(rt, device, encoder, cam, frame, sampled, voxelized)
  const batchCount = ceilDiv(Math.max(traced.length, 1), set.perBatch)
  for (let batch = 0; batch < batchCount; batch++) {
    encodeBatchMasks(frame, batch)
    encodeBatchLight(frame, batch)
  }
  // The sky's light, added to the lights': it reads the parameters of the first batch alone.
  encodeHairLight(encoder, sky.get()!, skyGroup, set.groups[0]!.made, set.grid, true)
  set.lit = true
}

/** Where the strands are laid on the image (`hairStrandsComposition`): before the transparents are drawn, or — the reference's
 *  default and the other two of its choices, which our separate translucency, composed after the depth of field, makes one —
 *  after the standard ones. */
type HairCompositionPlace = 'beforeTranslucent' | 'afterTranslucent'

const PLACES: Record<string, HairCompositionPlace> = {
  beforeTranslucent: 'beforeTranslucent',
  afterTranslucent: 'afterTranslucent',
  afterSeparateTranslucent: 'afterTranslucent',
  afterTranslucentBeforeDepthOfField: 'afterTranslucent',
}

/**
 * Lays the lit strands on `gpu.hdrView` where the setting `hairStrandsComposition` puts them, when `at` is that place, the fog
 * along the way to the strands taken in (the fog pass's own code) and the strands' velocity written where the temporal
 * pass will read it. Nothing where the image's strands were not lit (`encodeHairLighting`) or the place is another.
 */
export function composeHairStrands(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  at: HairCompositionPlace,
) {
  const { gpu } = rt
  const view = gpu.hair
  const set = view?.lighting
  const record = view?.record
  if (!set?.lit || !record || !gpu.hdrView) return
  if (PLACES[readHairStrandsSetting(rt, 'hairStrandsComposition')] !== at) return
  const fog = gpu.deferred?.fogBinding()
  const pipeline = fog && hairComposePipeline(device, fog.layout, fog.localFog).get()
  if (!fog || !pipeline) return
  set.lit = false
  const { nodes, targets } = record
  // The strands' velocity: the camera's alone at the nearest strand's depth.
  const velocity = gpu.velocity?.measured ? gpu.velocity : undefined
  if (velocity) {
    const steps = velocityRun.begin(encoder)
    velocity.encodeHair(steps, targets.hairOnlyDepthView)
    steps.end()
  }
  const size = view.inputs.size
  set.imageWords.u[0] = size[0]
  set.imageWords.u[1] = size[1]
  set.imageWords.u[2] = record.buffers.tiles.capacity
  writeChanged(device, set.image, set.imageWords.u, 0, HAIR_COMPOSE_IMAGE_WORDS)
  if (
    set.sources?.nodeIndexView !== targets.nodeIndexView ||
    set.sources.coverageView !== targets.coverageView ||
    set.sources.nearestDepth !== targets.hairOnlyDepthView ||
    set.sources.light !== set.grid
  )
    set.sources = {
      image: set.image,
      nodeIndexView: targets.nodeIndexView,
      coverageView: targets.coverageView,
      nearestDepth: targets.hairOnlyDepthView,
      light: set.grid,
    }
  encodeHairComposition(
    device,
    encoder,
    pipeline,
    fog.group,
    set.composeBinds,
    record.buffers.tiles,
    nodes,
    set.sources,
    gpu.hdrView,
    size,
  )
}

/** The lights whose transmittance is traced, the frame's lights in the order the deep shadows took them (`deepShadowLights`): a
 *  light that drew a deep shadow takes its mask from it, another from the voxels where there are some; the lights that cast a
 *  shadow alone, as the reference makes a mask for the shadowed lights alone. */
function tracedLights(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  shadows: HairDeepShadows | undefined,
  voxelized: boolean,
  sampled: boolean,
): Tracing[] {
  const found: Tracing[] = []
  const entries = frameLights(rt, 'plan', cam)
  const deep = deepShadowIndexOf(entries, cam.eye)
  for (const { light: source } of entries) {
    const light = strandLightOf(source, cam.eye)
    if (!light || !source.castsShadow) continue
    // The local lights the sampled lighting draws are traced per draw, not per sample and light.
    if (sampled && !light.directional) continue
    const index = deep.get(source.id)
    const drawn =
      index === undefined ? undefined : shadows?.lights.find((entry) => entry.light === index)
    if (!drawn && !voxelized) continue
    found.push({ rank: rt.lights.store.slotOf(source.id), light, deepOffset: drawn?.offset })
  }
  return found
}
