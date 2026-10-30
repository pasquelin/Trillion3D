import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { isPending, isReady } from '../../rays/sceneTrace/sceneMaskHold.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { NEVER_SEEN } from '../../../frame/backend/state/previousCamera.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { createCachedGroup } from '../../../gpu/bind/cachedGroup.ts'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { blueNoiseNow } from '../../../gpu/noise/blueNoiseTextures.ts'
import { preExposureOf } from '../../../post/exposure/pre.ts'
import { cachedLightingPreExposureOf } from '../../../post/exposure/frame.ts'
import { vectorsReach } from '../../reflections/litImage.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { surfaceCacheLightOf } from '../../surfaceCache/light.ts'
import { surfaceHitCardsEntries } from '../../surfaceCache/hitWgsl.ts'
import { surfaceHitReads } from '../../surfaceCache/frame.ts'
import { sceneRaysOf } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { reflectionGroupOf } from '../../translucencyGi/image.ts'
import { NORMALS_VIEW } from '../irradianceField/pixels.ts'
import { encodeReservoirOcclusion } from '../screen/frame.ts'
import { screenProbeVectors } from '../screen/vectorSource.ts'
import { writeIndirectWords } from '../screen/indirectWords.ts'
import { screenProbeSettingsOf } from '../screen/settingsOf.ts'
import { TRACE_TRACED_HIT, TRACE_TRACED_SCENE } from '../screen/traceTracedWgsl.ts'
import { RESERVOIR_BINDINGS } from './commonWgsl.ts'
import { IMAGE_ENTRIES } from './imageWgsl.ts'
import { imageKernel, resampleKernel, traceKernel, traceMaker } from './kernels.ts'
import {
  createParamBlock,
  PARAM_SLOT,
  PARAM_SLOT_BYTES,
  RESERVOIR_PARAMS,
  RESERVOIR_SET,
  UPSAMPLE_METHODS,
  wordOf,
} from './params.ts'
import { RESAMPLE_ENTRIES } from './resampleWgsl.ts'
import { createReservoirResources, type LightSet, type ReservoirResources } from './resources.ts'
import { RESERVOIR_TRACE_ENTRY } from './traceWgsl.ts'

const B = RESERVOIR_BINDINGS
/** The images the gather's resources are kept for after the final gather method moved off the reservoirs. */
const KEEP_IMAGES = 120
/** The settings of the screen probes, which hold the reservoir gather's. */
type ReservoirValues = ScreenProbeSettings['values']

/** What the gather holds of a view between images. */
interface Held {
  resources?: ReservoirResources
  key: string
  /** The image number the last reservoirs and accumulation were made at, and the parity of the set they were written to. */
  lastImage: number
  /** The image the last reservoirs, then the last accumulated light, were written at (a pass switched off leaves its history behind). */
  temporalImage: number
  accumulateImage: number
  /** Whether the reset of the temporal resampling was on at the last image, and one is still to be done (the reference clears its switch once the reset is made: here it resets when the setting turns on). */
  resetAsked: boolean
  resetPending: boolean
  turn: 0 | 1
  idle: number
  /** The inverse of the view-projection the last lit image was drawn with, rewritten each image. */
  readonly inverse: Float64Array
  readonly params: ReturnType<typeof createParamBlock>
  readonly groups: Record<string, ReturnType<typeof createCachedGroup>>
  sceneBinder?: ReturnType<typeof sceneTraceGroupBinder>
}
const held = new WeakMap<WebgpuPagesRuntime['gpu'], Held>()

const heldOf = (rt: WebgpuPagesRuntime): Held => {
  let state = held.get(rt.gpu)
  if (!state) {
    state = {
      key: '',
      lastImage: NEVER_SEEN,
      temporalImage: NEVER_SEEN,
      accumulateImage: NEVER_SEEN,
      resetAsked: false,
      resetPending: false,
      turn: 0,
      idle: 0,
      inverse: new Float64Array(16),
      params: createParamBlock(),
      groups: {},
    }
    held.set(rt.gpu, state)
  }
  return state
}

/**
 * Writes the slots of an image's dispatches: what they share (the reservoir view, the image, the exposure, the limits, the cards' sampling, the sky light that leaks) and what each pass owns (`fill`). `values` are the
 * settings, `frame` the number the reservoirs of this image are placed with, `last` the one of the last image, `pre` the pre-exposure of this image and of the last.
 */
function fillParams(
  state: Held,
  resources: ReservoirResources,
  values: ReservoirValues,
  common: {
    frame: number
    last: number
    pre: readonly [number, number]
    inverse: Float64Array
    depthBias: number
    minHit: number
    avoid: number
  },
) {
  const { floats, words } = state.params
  const [rw, rh] = resources.reduced
  const maxTrace = values.screenProbeMaxTraceDistance
  const leakDistance = Math.min(values.screenProbeFullSkylightLeakingDistance, maxTrace)
  for (let slot = 0; slot < PARAM_SLOT.count; slot++) {
    const at = (field: keyof typeof RESERVOIR_PARAMS.at) => wordOf(slot, field)
    words.set([rw, rh, resources.factor, common.frame], at('size'))
    words.set([resources.size[0], resources.size[1], common.last, 0], at('image'))
    floats.set(
      [
        common.pre[0],
        common.pre[0] / common.pre[1],
        values.reservoirGatherMaxRayIntensity,
        maxTrace,
      ],
      at('exposure'),
    )
    floats.set(
      [
        values.reservoirGatherResamplingDepthErrorThreshold,
        Math.cos(values.reservoirGatherResamplingAngleThreshold * DEG2RAD),
        0,
        0,
      ],
      at('threshold'),
    )
    floats.set(
      [
        values.reservoirGatherSpatialResamplingKernelRadius * rw,
        values.reservoirGatherSpatialResamplingOcclusionScreenTraceDistance,
        values.reservoirGatherSpatialResamplingNumSamples,
        0,
      ],
      at('spatial'),
    )
    const method = UPSAMPLE_METHODS.indexOf(values.reservoirGatherUpsampleMethod)
    floats.set(
      [
        method,
        values.reservoirGatherUpsampleKernelSize,
        values.reservoirGatherUpsampleNumSamples,
        // The passthrough computes no variance of its own: only the disocclusions the accumulation finds are blurred.
        values.reservoirGatherBilateralFilter ? 1 : 0,
      ],
      at('upsample'),
    )
    const speed = 1 / Math.sqrt(clamp(values.screenProbeUpdateSpeed, 0.5, 8))
    floats.set(
      [
        Math.max(1, Math.round(values.reservoirGatherTemporalMaxFramesAccumulated * speed)),
        values.reservoirGatherTemporalDistanceThreshold,
        0,
        0,
      ],
      at('accumulate'),
    )
    floats.set(
      [
        values.reservoirGatherBilateralFilterSpatialKernelRadius,
        values.reservoirGatherBilateralFilterNumSamples,
        values.reservoirGatherBilateralFilterDepthWeightScale,
        values.reservoirGatherBilateralFilterNormalAngleThresholdScale,
      ],
      at('bilateral'),
    )
    floats.set(
      [values.reservoirGatherBilateralFilterStrongBlurVarianceThreshold, 0, 0, 0],
      at('strong'),
    )
    floats.set([common.depthBias, common.minHit, common.avoid, 0], at('trace'))
    floats.set(
      [values.screenProbeSkylightLeakingRoughness, 1 / Math.max(leakDistance, 1e-6), 0, 0],
      at('leak'),
    )
    floats.set(common.inverse, at('previousInverse'))
  }
}

/** The fields of the slot `slot` set apart from the common ones. */
function fill(
  state: Held,
  slot: number,
  fields: Partial<Record<'sets' | 'history' | 'trace' | 'spatial', readonly number[]>>,
) {
  const { floats, words } = state.params
  if (fields.sets) words.set(fields.sets, wordOf(slot, 'sets'))
  if (fields.history) words[wordOf(slot, 'image') + 3] = fields.history[0]!
  if (fields.trace) floats[wordOf(slot, 'trace') + 3] = fields.trace[0]!
  if (fields.spatial) floats[wordOf(slot, 'spatial') + 3] = fields.spatial[0]!
}

/** A dispatch over `x` by `y` workgroups of `pipeline` in `pass`, group 0 read at the parameter slot `slot`, then the reflection group and, where it has one, the scene trace's. */
function dispatch(
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  groups: readonly GPUBindGroup[],
  slot: number,
  size: readonly [number, number],
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, groups[0]!, [slot * PARAM_SLOT_BYTES])
  for (let at = 1; at < groups.length; at++) pass.setBindGroup(at, groups[at]!)
  pass.dispatchWorkgroups(ceilDiv(size[0], 8), ceilDiv(size[1], 8))
}

/** The resources at the size of the image and the reduction asked: the held ones, else made (at a larger reduction where the pools pass the device's limits, none past `MAX_FACTOR`); the history starts over when they are made. */
const MAX_FACTOR = 8
const reservoirResourcesOf = (
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  state: Held,
  factor: number,
) => {
  const [w, h] = rt.gpu.targetSize
  const key = `${w}x${h}:${factor}`
  if (state.key !== key) {
    state.resources?.dispose()
    // The reduction goes up until the pools fit the device's largest storage buffer.
    state.resources = undefined
    for (let reduction = factor; reduction <= MAX_FACTOR && !state.resources; reduction++)
      state.resources = createReservoirResources(device, [w, h], reduction)
    state.key = key
    state.lastImage = NEVER_SEEN
    for (const name of Object.keys(state.groups)) delete state.groups[name]
  }
  return state.resources
}

/** The entries that bind a light set's colour at `light` and rough specular at `rest` and, where `framesAt` is given, its frames (`frames`, else the set's own) there. */
const lightEntries = (
  light: number,
  rest: number,
  from: LightSet,
  framesAt?: number,
  frames = from.frames,
): GPUBindGroupEntry[] => [
  { binding: light, resource: from.light },
  { binding: rest, resource: from.rest },
  ...(framesAt !== undefined && frames ? [{ binding: framesAt, resource: frames }] : []),
]

/**
 * THE RESERVOIR GATHER OF THE PIXELS' INDIRECT LIGHT (`finalGatherMethod` 'reservoirs'), in the order of the reference's: the last image's reservoirs validated every N images (their rays traced again),
 * the first rays — one for each texel of the reservoir view, a uniform direction of the hemisphere, traced through the scene's triangles and lit by the cards the hit meets —, the temporal resampling (or,
 * without history, a cleared history), the spatial passes, the upsampling and integration to the pixels, the temporal accumulation, the bilateral filter, then the one write of the lighting's words
 * (`writeIndirectWords`). Nothing while a kernel compiles or the frame lacks the scene trace of the image, the cards, the surfaces or the vectors' reach: the lighting then takes the sky light's irradiance.
 */
export function encodeReservoirGather(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = heldOf(rt)
  state.idle = 0
  const values = screenProbeSettingsOf(rt).values
  const { surfaces } = rt.gpu
  const reflection = rt.gpu.reflection
  const reflectionGroup = reflectionGroupOf(rt)
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  const noise = blueNoiseNow(device)
  const light = surfaceCacheLightOf(rt, device)
  // The kernels that do not depend on the scene trace compile from the first image, whatever the guard below holds back.
  const resample = resampleKernel(device)
  const pixels = imageKernel(device)
  if (!surfaces || !reflection || !reflectionGroup || !rays || !noise) return
  const trace = rays.sceneTrace.maskHold.use(
    'reservoir gather',
    light,
    traceMaker(device, light),
    isReady,
    isPending,
  )?.kernel
  if (!trace?.ready || !resample.ready || !pixels.ready) return
  const resources = reservoirResourcesOf(rt, device, state, values.reservoirGatherDownsampleFactor)
  if (!resources) return

  const image = rt.run.frame
  const fixed = values.reservoirGatherFixedJitterIndex
  const frame = fixed >= 0 ? fixed : image
  const last = fixed >= 0 ? fixed : image - 1
  const pre = preExposureOf(rt)
  const reach = vectorsReach(reflection.lit.held, reflection.frame.image ?? NEVER_SEEN)
  const continues = state.lastImage === image - 1 && reach
  const previousInverse = state.inverse
  if (!invertMatrix4(previousInverse, reflection.lit.held.viewProjection)) previousInverse.fill(0)
  fillParams(state, resources, values, {
    frame,
    last,
    pre: [pre.now, pre.previous],
    inverse: previousInverse,
    depthBias: rays.depthBias,
    minHit: rays.minHitDistance,
    avoid: rays.selfIntersections,
  })

  const temporal = values.reservoirGatherTemporalResampling
  const history = RESERVOIR_SET.history
  const previousSet = history[state.turn]
  const currentSet = history[1 - state.turn]
  const resetAsked = values.reservoirGatherTemporalResamplingResetHistory
  if (resetAsked && !state.resetAsked) state.resetPending = true
  state.resetAsked = resetAsked
  const historyOk = continues && state.temporalImage === image - 1 && !state.resetPending
  // The clearing of the history is the reset made.
  if (temporal) state.resetPending = false
  const validates =
    temporal &&
    historyOk &&
    values.reservoirGatherValidateTemporalReservoirsEveryNFrames > 0 &&
    image % values.reservoirGatherValidateTemporalReservoirsEveryNFrames === 0

  // The slots of the dispatches.
  fill(state, PARAM_SLOT.validate, { sets: [0, 0, previousSet, 0], trace: [1] })
  fill(state, PARAM_SLOT.rays, { sets: [0, RESERVOIR_SET.rays, 0, 0], trace: [0] })
  fill(state, PARAM_SLOT.temporal, {
    sets: [RESERVOIR_SET.rays, currentSet, previousSet, 0],
    history: [1],
  })
  let final: number = RESERVOIR_SET.rays
  if (temporal && historyOk) final = currentSet
  const passes = values.reservoirGatherSpatialResampling
    ? values.reservoirGatherSpatialResamplingNumPasses
    : 0
  const spatialSets: number[] = []
  for (let pass = 0; pass < passes; pass++) {
    const out = final === RESERVOIR_SET.rays ? RESERVOIR_SET.spatial : RESERVOIR_SET.rays
    fill(state, PARAM_SLOT.spatial + pass, { sets: [final, out, 0, 0], spatial: [pass] })
    spatialSets.push(final)
    final = out
  }
  fill(state, PARAM_SLOT.upsample, { sets: [final, 0, 0, 0] })
  const accumulates = values.reservoirGatherTemporal
  // A great change of the lighting (`bounce.historyLost`) also drops the accumulated light.
  const accumulateHistory =
    continues &&
    state.accumulateImage === image - 1 &&
    !values.reservoirGatherClearHistoryEveryFrame &&
    !rt.bounce.historyLost
  fill(state, PARAM_SLOT.accumulate, { history: [accumulateHistory ? 1 : 0] })
  device.queue.writeBuffer(resources.params, 0, state.params.bytes)

  const frames = surfaces.views()
  const normals = frames[NORMALS_VIEW]
  const vectors = (reach && screenProbeVectors(rt)) || reflection.noVectors
  const hit = surfaceHitReads(rt, device, undefined, light).hit
  const [poolRays, poolHistory] = resources.pools
  const shared = (): GPUBindGroupEntry[] => [
    { binding: B.params, resource: { buffer: resources.params, size: PARAM_SLOT_BYTES } },
    { binding: B.blue, resource: noise.view },
    { binding: B.poolA, resource: { buffer: poolRays } },
    { binding: B.poolB, resource: { buffer: poolHistory } },
    { binding: B.normals, resource: normals },
  ]

  const groupOf = (name: string, depth = 1) => (state.groups[name] ??= createCachedGroup(depth))
  const traceGroup = groupOf('trace')(
    device,
    trace.layouts[0]!,
    [
      resources,
      noise.view,
      normals,
      rays.views.nodes,
      rays.views.frames,
      rays.views.worlds,
      rays.views.tree,
      hit.tables,
      hit.depth,
      hit.final,
      hit.instances,
    ],
    () => [
      ...shared(),
      ...dagReadGroupEntries(rays.views),
      ...surfaceHitCardsEntries(TRACE_TRACED_HIT, hit),
    ],
    'Trillion3D reservoir rays',
  )
  state.sceneBinder ??= sceneTraceGroupBinder(device)
  const sceneGroup = state.sceneBinder(
    trace.layouts[TRACE_TRACED_SCENE.group]!,
    rays.sceneTrace,
    TRACE_TRACED_SCENE.first,
  )
  const resampleGroup = groupOf('resample')(
    device,
    resample.layouts[0]!,
    [resources, noise.view, normals, vectors],
    () => [...shared(), { binding: B.vectors, resource: vectors }],
    'Trillion3D reservoir resampling',
  )

  // The textures of light: the history of the last image is read, this image's written (the sets alternate, so a group is kept for each); a pass binds the ones it does not use all the same, clear of the ones it writes.
  const previousLight = resources.history[state.turn]
  const currentLight = resources.history[1 - state.turn]
  const pixelGroup = (name: string, reads: LightSet, writes: LightSet) =>
    groupOf(name, 2)(
      device,
      pixels.layouts[0]!,
      [resources, noise.view, normals, vectors, reads, writes, previousLight, currentLight],
      () => [
        ...shared(),
        { binding: B.vectors, resource: vectors },
        ...lightEntries(B.lightIn, B.restIn, reads),
        ...lightEntries(B.historyLight, B.historyRest, previousLight, B.historyFrames),
        ...lightEntries(B.lightOut, B.restOut, writes, B.framesOut, currentLight.frames),
      ],
      `Trillion3D reservoir pixels ${name}`,
    )
  return finish(rt, device, encoder, state, resources, {
    trace,
    resample,
    pixels,
    traceGroups: [traceGroup, reflectionGroup, sceneGroup],
    resampleGroups: [resampleGroup, reflectionGroup],
    pixelGroup,
    reflectionGroup,
    validates,
    temporal,
    historyOk,
    spatialSets,
    accumulates,
    values,
    currentLight,
    previousLight,
    pre,
  })
}

/** What `encodeReservoirGather` has made ready for the dispatches. */
interface Ready {
  trace: ReturnType<typeof traceKernel>
  resample: ReturnType<typeof resampleKernel>
  pixels: ReturnType<typeof imageKernel>
  traceGroups: readonly GPUBindGroup[]
  resampleGroups: readonly GPUBindGroup[]
  pixelGroup: (name: string, reads: LightSet, writes: LightSet) => GPUBindGroup
  reflectionGroup: GPUBindGroup
  validates: boolean
  temporal: boolean
  historyOk: boolean
  spatialSets: readonly number[]
  accumulates: boolean
  values: ReservoirValues
  currentLight: LightSet
  previousLight: LightSet
  pre: ReturnType<typeof preExposureOf>
}

/** The dispatches of the chain, then the lighting's words from the light it ends with. */
function finish(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: Held,
  resources: ReservoirResources,
  r: Ready,
) {
  const pass = encoder.beginComputePass({ label: 'Trillion3D reservoir gather' })
  if (r.validates)
    dispatch(
      pass,
      r.trace.pipeline(RESERVOIR_TRACE_ENTRY),
      r.traceGroups,
      PARAM_SLOT.validate,
      resources.reduced,
    )
  dispatch(
    pass,
    r.trace.pipeline(RESERVOIR_TRACE_ENTRY),
    r.traceGroups,
    PARAM_SLOT.rays,
    resources.reduced,
  )
  if (r.temporal) {
    const entry = r.historyOk ? RESAMPLE_ENTRIES.temporal : RESAMPLE_ENTRIES.clear
    dispatch(
      pass,
      r.resample.pipeline(entry),
      r.resampleGroups,
      PARAM_SLOT.temporal,
      resources.reduced,
    )
  }
  r.spatialSets.forEach((_, at) =>
    dispatch(
      pass,
      r.resample.pipeline(RESAMPLE_ENTRIES.spatial),
      r.resampleGroups,
      PARAM_SLOT.spatial + at,
      resources.reduced,
    ),
  )
  const pixelGroups = (name: string, reads: LightSet, writes: LightSet) =>
    [r.pixelGroup(name, reads, writes), r.reflectionGroup] as const
  const size = resources.size
  const pixelKernel = (
    entry: (typeof IMAGE_ENTRIES)[keyof typeof IMAGE_ENTRIES],
    groups: readonly GPUBindGroup[],
    slot: number,
  ) => dispatch(pass, r.pixels.pipeline(entry), groups, slot, size)
  let result: LightSet = resources.upsampled
  // The upsampling reads no light: it binds the last image's, clear of the textures it writes.
  pixelKernel(
    IMAGE_ENTRIES.upsample,
    pixelGroups('upsample', r.previousLight, resources.upsampled),
    PARAM_SLOT.upsample,
  )
  if (r.accumulates) {
    pixelKernel(
      IMAGE_ENTRIES.accumulate,
      pixelGroups('accumulate', resources.upsampled, r.currentLight),
      PARAM_SLOT.accumulate,
    )
    result = r.currentLight
  }
  if (r.values.reservoirGatherBilateralFilter) {
    pixelKernel(
      IMAGE_ENTRIES.bilateral,
      pixelGroups('bilateral', result, resources.filtered),
      PARAM_SLOT.bilateral,
    )
    result = resources.filtered
  }
  pass.end()
  state.lastImage = rt.run.frame
  if (r.temporal) state.temporalImage = rt.run.frame
  if (r.accumulates) state.accumulateImage = rt.run.frame
  state.turn = (1 - state.turn) as 0 | 1
  // The short-range occlusion the spatial filtering lacks (`reservoirGatherShortRangeAO`), which the lighting then applies to the light; none where the pass searches none.
  const occlusion = encodeReservoirOcclusion(rt, encoder)
  writeIndirectWords(rt, device, encoder, {
    light: result.light,
    rough: result.rest,
    open: occlusion?.view ?? result.light,
    reduction: 1,
    alphaAnswers: true,
    openTexture: !!occlusion,
    openReduction: occlusion?.reduction ?? 0,
    openBent: occlusion?.bent ?? false,
    // The light is written under the image's pre-exposure: the words are under the cached lighting's.
    exposure: cachedLightingPreExposureOf(rt) / r.pre.now,
    appliesOcclusion: !!occlusion,
  })
}

/** An image whose pixels the reservoirs did not gather: the gather's resources are given back after `KEEP_IMAGES` of them. */
export function idleReservoirGather(rt: WebgpuPagesRuntime) {
  const state = held.get(rt.gpu)
  if (!state?.resources || ++state.idle < KEEP_IMAGES) return
  state.resources.dispose()
  state.resources = undefined
  state.key = ''
}
