import { stagesPending, stagesReady } from '../../rays/sceneTrace/sceneMaskHold.ts'
import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
} from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import {
  tracedDownsampleOf,
  tracedPrimaryEventsOf,
  tracedRefractionOn,
  tracedSecondaryEventsOf,
  tracedTranslucencyOn,
  type TracedTranslucencyValues,
} from '../../../../../sdk-core/src/contracts/tracedTranslucencyOptions.ts'
import { waterFrontOf } from '../../../blend/water/waterReflection.ts'
import {
  TRACED_TRANSLUCENCY_COMPOSE_PASS,
  TRACED_TRANSLUCENCY_DENOISE_PASS,
  TRACED_TRANSLUCENCY_TRACE_PASS,
} from '../../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { wantsContractLighting } from '../../../frame/prepare/lit.ts'
import { skyLightReadOf } from '../../../frame/render/skyLightState.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { computeTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import {
  BLEND_EQUATIONS,
  COLOUR_ONLY,
  OVER,
  SCALED_BY_ALPHA,
} from '../../../materials/surface/materialBlending.ts'
import { drawsLit } from '../../../visibility/shader/shadeMode.ts'
import {
  TRACE_TRACED_FOG,
  TRACE_TRACED_HIT,
  TRACE_TRACED_SCENE,
} from '../../bounce/screen/traceTracedWgsl.ts'
import { chainReady, fullscreenDescriptor, preparedPipeline } from '../../deferred/fullscreen.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { surfaceHitReads } from '../../surfaceCache/frame.ts'
import { surfaceHitCardsEntries } from '../../surfaceCache/hitWgsl.ts'
import { surfaceCacheLightOf } from '../../surfaceCache/light.ts'
import { sceneRaysOf } from '../../surfaceCache/lighting/surfaceLighting.ts'
import { rayFogBindEntries } from '../rayFog.ts'
import { frontStamp } from '../frontLayer.ts'
import { reflectionGroup, reflectionLightView } from '../group.ts'
import { reflectionLayout } from '../reflectionPipelines.ts'
import {
  RTT_DENOISE_BINDINGS,
  RTT_FINAL_FORMAT,
  RTT_HISTORY_FORMAT,
  RTT_PASS_ENTRIES,
  RTT_PAST_FORMAT,
  RTT_RESOLVE_ENTRY,
  RTT_RESOLVED_FORMAT,
  RTT_SPATIAL_ENTRY,
  RTT_TEMPORAL_ENTRY,
  tracedTranslucencyDenoiseProgram,
} from './denoiseWgsl.ts'
import {
  RTT_BACKGROUND_FORMAT,
  RTT_FLAG,
  RTT_PARAMS,
  RTT_RADIANCE_FORMAT,
  RTT_THROUGHPUT_FORMAT,
  RTT_TRACE_BINDINGS,
  RTT_TRACE_ENTRY,
  tracedTranslucencyEntries,
  tracedTranslucencyProgram,
  tracedTranslucencySceneEntries,
} from './traceWgsl.ts'

/** The kernel's workgroup side. */
const SIDE = 8

/** The scale (`scale`: the throughput multiplies the image, its alpha the image's alpha) and the add (`add`: the radiance laid on the colour). */
const COMPOSE_BINDINGS = { radiance: 0, throughput: 1 } as const
const COMPOSE_WGSL = wgslProgram(
  `@group(0) @binding(${COMPOSE_BINDINGS.radiance}) var rttFinalRadiance:texture_2d<f32>;
@group(0) @binding(${COMPOSE_BINDINGS.throughput}) var rttFinalThroughput:texture_2d<f32>;
@fragment fn scale(@builtin(position) pixel:vec4f)->@location(0) vec4f{return textureLoad(rttFinalThroughput,vec2i(pixel.xy),0);}
@fragment fn add(@builtin(position) pixel:vec4f)->@location(0) vec4f{return vec4f(textureLoad(rttFinalRadiance,vec2i(pixel.xy),0).rgb,0.0);}`,
  [FULLSCREEN_VERTEX],
)

const composeLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D traced translucency compose',
    entries: [
      computeTextureEntry(COMPOSE_BINDINGS.radiance, 'float', '2d', GPUShaderStage.FRAGMENT),
      computeTextureEntry(COMPOSE_BINDINGS.throughput, 'float', '2d', GPUShaderStage.FRAGMENT),
    ],
  }),
)

/** The composition's two draws, compiled off the frame: the image times the throughput (and its alpha times the background left visible), then the radiance laid over it. */
const composePipelines = oncePerDevice((device: GPUDevice) => {
  const module = device.createShaderModule({
    label: 'Trillion3D traced translucency compose',
    code: COMPOSE_WGSL,
  })
  const draw = (entry: string, blend: GPUBlendState, writeMask?: number) =>
    preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        composeLayout(device),
        entry,
        [{ format: HDR_FORMAT, blend, ...(writeMask !== undefined && { writeMask }) }],
        'Trillion3D traced translucency compose',
      ),
    )
  return [
    draw('scale', { color: BLEND_EQUATIONS.multiply.color, alpha: SCALED_BY_ALPHA }),
    draw('add', { color: OVER, alpha: OVER }, COLOUR_ONLY),
  ] as const
})

/** The trace's kernel for the surface cache's final light in `light`, over the graph masks `programs` its rays cut the surfaces by (the programs `maskHold.use` returns), compiled off the frame and not waited for: the raster draws the surfaces until it is. */
const traceKernel = oncePerDeviceOverPrograms(
  (device: GPUDevice, light: LightAtlasFormat, programs) => {
    const label = `Trillion3D traced translucency trace ${light} ${sceneMaskKey(programs)}`
    const layouts = [
      device.createBindGroupLayout({ label, entries: tracedTranslucencyEntries(light) }),
      reflectionLayout(device),
      device.createBindGroupLayout({ label, entries: tracedTranslucencySceneEntries() }),
    ]
    const stages = startedComputeStages(
      device,
      label,
      device.createPipelineLayout({ bindGroupLayouts: layouts }),
      device.createShaderModule({ label, code: tracedTranslucencyProgram(light, programs) }),
      [RTT_TRACE_ENTRY],
    )
    return { layouts, stages }
  },
)
const traceMaker = heldMakerOf(traceKernel)

/** The denoising's three kernels (the resolve, the temporal accumulation, the spatial filter), compiled off the frame, each over its own layout. */
const denoiseKernels = oncePerDevice((device: GPUDevice) =>
  ([RTT_RESOLVE_ENTRY, RTT_TEMPORAL_ENTRY, RTT_SPATIAL_ENTRY] as const).map((entry) => {
    const label = `Trillion3D traced translucency ${entry}`
    const layouts = [
      device.createBindGroupLayout({ label, entries: RTT_PASS_ENTRIES[entry]() }),
      reflectionLayout(device),
    ]
    const stages = startedComputeStages(
      device,
      label,
      device.createPipelineLayout({ bindGroupLayouts: layouts }),
      device.createShaderModule({ label, code: tracedTranslucencyDenoiseProgram(entry) }),
      [entry],
    )
    return { entry, layouts, stages }
  }),
)

/** The textures of one size: the trace's three (a texel a block of pixels), the resolved radiance, the history and its past, two each that take turns, and the radiance and throughput the composition reads. */
function createTextures(device: GPUDevice, size: readonly [number, number], block: number) {
  const make = (label: string, format: GPUTextureFormat, [w, h]: readonly [number, number]) =>
    device.createTexture({
      label: `Trillion3D traced translucency ${label}`,
      size: [w, h],
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  const trace: [number, number] = [ceilDiv(size[0], block), ceilDiv(size[1], block)]
  return {
    size: [size[0], size[1]] as const,
    block,
    trace,
    radiance: make('radiance', RTT_RADIANCE_FORMAT, trace),
    throughput: make('throughput', RTT_THROUGHPUT_FORMAT, trace),
    background: make('background', RTT_BACKGROUND_FORMAT, trace),
    resolved: make('resolved', RTT_RESOLVED_FORMAT, size),
    history: [
      make('history 0', RTT_HISTORY_FORMAT, size),
      make('history 1', RTT_HISTORY_FORMAT, size),
    ] as const,
    past: [make('past 0', RTT_PAST_FORMAT, size), make('past 1', RTT_PAST_FORMAT, size)] as const,
    finalRadiance: make('final radiance', RTT_FINAL_FORMAT, size),
    finalThroughput: make('final throughput', RTT_FINAL_FORMAT, size),
  }
}
type Textures = ReturnType<typeof createTextures>

/** The textures given back. */
const destroyTextures = (t: Textures) =>
  [
    t.radiance,
    t.throughput,
    t.background,
    t.resolved,
    ...t.history,
    ...t.past,
    t.finalRadiance,
    t.finalThroughput,
  ].forEach((texture) => texture.destroy())

/** What the stage keeps on a runtime between images. */
interface TracedTranslucencyState {
  device: GPUDevice
  textures?: Textures
  params?: GPUBuffer
  /** The history that holds the last image (0 or 1), the image it was written in, and what the surface cache's hit reads were. */
  turn: 0 | 1
  lastFrame: number
  reads?: ReturnType<typeof surfaceHitReads>
  readonly identity: ReturnType<typeof createWebgpuBindIdentity>
  readonly composeIdentity: ReturnType<typeof createWebgpuBindIdentity>
  traceGroup?: GPUBindGroup
  /** The resolve's group, then the temporal and spatial groups of each turn; made again when the front layer's normals are another view. */
  resolveGroup?: GPUBindGroup
  denoiseGroups: [GPUBindGroup | undefined, GPUBindGroup | undefined]
  spatialGroups: [GPUBindGroup | undefined, GPUBindGroup | undefined]
  normals?: GPUTextureView
  composeGroup?: GPUBindGroup
  readonly sceneGroup: ReturnType<typeof sceneTraceGroupBinder>
}

const states = new WeakMap<object, TracedTranslucencyState>()

function stateOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  let state = states.get(rt.gpu)
  if (state?.device !== device) {
    if (state?.textures) destroyTextures(state.textures)
    state?.params?.destroy()
    state = {
      device,
      turn: 0,
      lastFrame: -2,
      identity: createWebgpuBindIdentity(),
      composeIdentity: createWebgpuBindIdentity(),
      denoiseGroups: [undefined, undefined],
      spatialGroups: [undefined, undefined],
      sceneGroup: sceneTraceGroupBinder(device),
    }
    states.set(rt.gpu, state)
  }
  return state
}

/** The traced translucency's settings of the image, resolved with the reflections', when the view is the main one of a perspective camera lit by the contract's lighting and the scene is traced through its triangles. */
export function tracedTranslucencyValuesOf(
  rt: WebgpuPagesRuntime,
): TracedTranslucencyValues | undefined {
  const reflection = rt.gpu.reflection
  if (
    !reflection ||
    rt.views.active !== rt.views.main ||
    rt.run.gate.cam.perspective !== 1 ||
    !wantsContractLighting(rt) ||
    !drawsLit(rt.run.diagnostic)
  )
    return undefined
  const { traced } = reflection.settings(rt.context, waterFrontOf(rt))
  return tracedTranslucencyOn(traced) ? traced : undefined
}

/** Whether the lighting keeps the scene trace for this image because the see-through surfaces are traced (`LightingInputs.probes`). */
export const tracedTranslucencyTraced = (rt: WebgpuPagesRuntime) => !!tracedTranslucencyValuesOf(rt)

/** Writes the image's parameters (`RTT_PARAMS`) into the stage's uniform. */
function writeParams(
  device: GPUDevice,
  state: TracedTranslucencyState,
  v: TracedTranslucencyValues,
  textures: Textures,
  rt: WebgpuPagesRuntime,
  historyValid: boolean,
) {
  const reflection = rt.gpu.reflection!
  const words = new Uint32Array(RTT_PARAMS.words)
  const floats = new Float32Array(words.buffer)
  const P = RTT_PARAMS.at
  words.set([textures.trace[0], textures.trace[1], textures.block, rt.run.frame & 0xffff], P.size)
  const flags =
    (tracedRefractionOn(v) ? RTT_FLAG.refraction : 0) |
    (v.rayTracedTranslucencySampleTranslucentReflectionInReflections
      ? RTT_FLAG.sampleReflection
      : 0) |
    (v.rayTracedTranslucencyForceOpaque ? RTT_FLAG.forceOpaque : 0)
  words.set([tracedPrimaryEventsOf(v), tracedSecondaryEventsOf(v), flags, 0], P.events)
  floats.set(
    [
      v.rayTracedTranslucencyPathThroughputThreshold,
      v.rayTracedTranslucencyMaxRayIntensity,
      reflection.frame.preExposure ?? 1,
      0,
    ],
    P.limits,
  )
  floats.set([0, 0, historyValid ? 1 : 0, 0], P.history)
  state.params ??= device.createBuffer({
    label: 'Trillion3D traced translucency parameters',
    size: RTT_PARAMS.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(state.params, 0, words)
}

/**
 * THE SEE-THROUGH SURFACES DRAWN BY RAYS, in the image's colour: where the settings say so (`tracedTranslucencyOn`) and the image has what the rays need — the scene trace the lighting made for it, the
 * front pass's depth, the kernels compiled — the three passes run on `encoder` and the raster draws of the transparents are left out; false otherwise, and the raster draws them as before.
 * The trace (`traceWgsl.ts`) casts a ray for each pixel the front layer covers (a block of `tracedDownsampleOf` pixels a side casting one, a different pixel each image), the denoising
 * (`denoiseWgsl.ts`) resolves and accumulates them, and the composition multiplies the lit image by the throughput and lays the radiance over it.
 */
export function encodeTracedTranslucency(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
): boolean {
  const v = tracedTranslucencyValuesOf(rt)
  const { gpu, vis, run } = rt
  const reflection = gpu.reflection
  const hiz = vis.gpuHiz
  const depth = hiz?.depth()
  const lightView = reflectionLightView(rt)
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, run.frame)
  if (
    !v ||
    !reflection ||
    !depth ||
    !lightView ||
    !rays ||
    !gpu.hdrView ||
    !vis.textures ||
    !vis.mapsSampler ||
    reflection.front.drawn !== frontStamp(run.frame)
  )
    return false
  const light = surfaceCacheLightOf(rt, device)
  const trace = rays.sceneTrace.maskHold.use(
    'translucency reflections',
    light,
    traceMaker(device, light),
    stagesReady,
    stagesPending,
  )?.kernel
  const denoise = denoiseKernels(device)
  const compose = composePipelines(device)
  if (
    !trace?.stages.ready ||
    !denoise.every(({ stages }) => stages.ready) ||
    !chainReady(...compose)
  )
    return false
  const state = stateOf(rt, device)
  const block = tracedDownsampleOf(v)
  const size = gpu.targetSize
  if (
    !state.textures ||
    state.textures.size[0] !== size[0] ||
    state.textures.size[1] !== size[1] ||
    state.textures.block !== block
  ) {
    if (state.textures) destroyTextures(state.textures)
    state.textures = createTextures(device, size, block)
    state.resolveGroup = undefined
    state.denoiseGroups = [undefined, undefined]
    state.spatialGroups = [undefined, undefined]
    state.lastFrame = -2
  }
  const textures = state.textures
  const historyValid = state.lastFrame === run.frame - 1 && !reflection.frame.historyCut
  writeParams(device, state, v, textures, rt, historyValid)
  state.reads = surfaceHitReads(rt, device, state.reads, light)
  const group1 = reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt))
  const { next } = state.identity
  next[0] = trace.layouts[0]
  next[1] = state.params
  next[2] = textures.radiance
  next[3] = textures.throughput
  next[4] = textures.background
  next[5] = rays.views.nodes
  next[6] = rays.views.frames
  next[7] = rays.views.worlds
  next[8] = rays.views.tree
  next[9] = state.reads.hit.tables
  next[10] = state.reads.hit.depth
  next[11] = state.reads.hit.final
  next[12] = state.reads.hit.instances
  next[13] = reflection.inputs.lights
  next[14] = reflection.inputs.fog.cubemap
  next[15] = reflection.inputs.fog.sampler
  if (state.identity.moved())
    state.traceGroup = device.createBindGroup({
      label: 'Trillion3D traced translucency trace',
      layout: trace.layouts[0],
      entries: [
        { binding: RTT_TRACE_BINDINGS.params, resource: { buffer: state.params! } },
        { binding: RTT_TRACE_BINDINGS.radiance, resource: textures.radiance.createView() },
        { binding: RTT_TRACE_BINDINGS.throughput, resource: textures.throughput.createView() },
        { binding: RTT_TRACE_BINDINGS.background, resource: textures.background.createView() },
        ...dagReadGroupEntries(rays.views),
        ...surfaceHitCardsEntries(TRACE_TRACED_HIT, state.reads.hit),
        { binding: TRACE_TRACED_FOG.lights, resource: { buffer: reflection.inputs.lights } },
        ...rayFogBindEntries(TRACE_TRACED_FOG, true, reflection.inputs.fog),
      ],
    })
  const scene = state.sceneGroup(
    trace.layouts[TRACE_TRACED_SCENE.group],
    rays.sceneTrace,
    TRACE_TRACED_SCENE.first,
  )
  const turn = state.turn
  const normals = reflection.front.views.normals
  if (state.normals !== normals) {
    state.normals = normals
    state.denoiseGroups = [undefined, undefined]
    state.spatialGroups = [undefined, undefined]
  }
  const D = RTT_DENOISE_BINDINGS
  const view = (texture: GPUTexture) => texture.createView()
  const [resolveKernel, temporalKernel, spatialKernel] = denoise
  const params = { binding: D.params, resource: { buffer: state.params! } }
  state.resolveGroup ??= device.createBindGroup({
    label: 'Trillion3D traced translucency resolve',
    layout: resolveKernel!.layouts[0],
    entries: [
      params,
      { binding: D.radiance, resource: view(textures.radiance) },
      { binding: D.throughput, resource: view(textures.throughput) },
      { binding: D.background, resource: view(textures.background) },
      { binding: D.resolved, resource: view(textures.resolved) },
      { binding: D.finalThroughput, resource: view(textures.finalThroughput) },
    ],
  })
  state.denoiseGroups[turn] ??= device.createBindGroup({
    label: 'Trillion3D traced translucency temporal',
    layout: temporalKernel!.layouts[0],
    entries: [
      params,
      { binding: D.resolved, resource: view(textures.resolved) },
      { binding: D.history, resource: view(textures.history[turn]) },
      { binding: D.past, resource: view(textures.past[turn]) },
      { binding: D.normals, resource: normals },
      { binding: D.historyOut, resource: view(textures.history[1 - turn]) },
      { binding: D.pastOut, resource: view(textures.past[1 - turn]) },
    ],
  })
  state.spatialGroups[turn] ??= device.createBindGroup({
    label: 'Trillion3D traced translucency spatial',
    layout: spatialKernel!.layouts[0],
    entries: [
      params,
      { binding: D.history, resource: view(textures.history[1 - turn]) },
      { binding: D.past, resource: view(textures.past[1 - turn]) },
      { binding: D.normals, resource: normals },
      { binding: D.finalRadiance, resource: view(textures.finalRadiance) },
    ],
  })
  const traced = encoder.beginComputePass({ label: TRACED_TRANSLUCENCY_TRACE_PASS })
  traced.setPipeline(trace.stages.pipelineOf(RTT_TRACE_ENTRY))
  traced.setBindGroup(0, state.traceGroup!)
  traced.setBindGroup(1, group1)
  traced.setBindGroup(TRACE_TRACED_SCENE.group, scene)
  traced.dispatchWorkgroups(ceilDiv(textures.trace[0], SIDE), ceilDiv(textures.trace[1], SIDE))
  traced.end()
  const denoised = encoder.beginComputePass({ label: TRACED_TRANSLUCENCY_DENOISE_PASS })
  const groups = [state.resolveGroup, state.denoiseGroups[turn]!, state.spatialGroups[turn]!]
  denoise.forEach(({ entry, stages }, pass) => {
    denoised.setPipeline(stages.pipelineOf(entry))
    denoised.setBindGroup(0, groups[pass]!)
    denoised.setBindGroup(1, group1)
    denoised.dispatchWorkgroups(ceilDiv(size[0], SIDE), ceilDiv(size[1], SIDE))
  })
  denoised.end()
  const { next: composeNext } = state.composeIdentity
  composeNext[0] = textures.finalRadiance
  composeNext[1] = textures.finalThroughput
  if (state.composeIdentity.moved())
    state.composeGroup = device.createBindGroup({
      layout: composeLayout(device),
      entries: [
        { binding: COMPOSE_BINDINGS.radiance, resource: textures.finalRadiance.createView() },
        { binding: COMPOSE_BINDINGS.throughput, resource: textures.finalThroughput.createView() },
      ],
    })
  const pass = encoder.beginRenderPass({
    label: TRACED_TRANSLUCENCY_COMPOSE_PASS,
    colorAttachments: [{ view: gpu.hdrView, loadOp: 'load', storeOp: 'store' }],
  })
  pass.setViewport(0, 0, size[0], size[1], 0, 1)
  pass.setBindGroup(0, state.composeGroup!)
  for (const draw of compose) {
    pass.setPipeline(draw.get()!)
    pass.draw(3)
  }
  pass.end()
  run.gpuDrawCalls += 2
  state.turn = (1 - turn) as 0 | 1
  state.lastFrame = run.frame
  return true
}
