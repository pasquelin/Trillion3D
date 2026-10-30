import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { noiseFrame } from '../../../frame/render/noiseFrame.ts'
import { preExposureOf } from '../../../post/exposure/pre.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { dispatchOn, layoutStagesOf } from '../../../gpu/core/computeStages.ts'
import { idleTooLong } from '../../../gpu/core/idleKeep.ts'
import { createRuns, namedGroups, type Runs } from '../../../gpu/core/encoderUniforms.ts'
import { loadOnlyUsage } from '../../../gpu/core/loadOnlyTarget.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { commitOnSubmit, retire } from '../../../gpu/core/frameRetire.ts'
import { chainReady } from '../../deferred/fullscreen.ts'
import type { SelfShadowRect } from '../firstPerson/selfShadowWindow.ts'
import { groupFor } from '../../../gpu/bind/cachedGroup.ts'
import {
  inputDeps,
  inputGroupEntries,
  type ScreenSpaceInputs,
} from '../../screenSpaceTracing/frame.ts'
import {
  DENOISE_BINDINGS as D,
  DENOISE_PARAMS_BYTES,
  DENOISE_PARAMS_WORDS,
  writeDenoiseParams,
} from '../../screenSpaceTracing/denoise/denoiseView.ts'
import {
  createDenoiseMeta,
  encodeDenoiseKeep,
  previousSlot,
  type DenoiseMeta,
} from '../../screenSpaceTracing/denoise/frame.ts'
import { denoiseKeepPipeline } from '../../screenSpaceTracing/denoise/pipelines.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../../screenSpaceTracing/rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../../screenSpaceTracing/screenSpaceQuality.ts'
import {
  releaseBesideInputs,
  screenSpaceFrameInputs,
  screenSpaceFrameReady,
  type PreviousImage,
} from '../../screenSpaceTracing/stage.ts'
import { inputEntries } from '../../screenSpaceTracing/pipelines.ts'
import { SHADOW_DENOISE_BINDINGS as SD } from './shadowDenoiseCommonWgsl.ts'
import { shadowFinalWgsl, shadowInjestWgsl, shadowSpatialWgsl } from './shadowDenoiseSpatialWgsl.ts'
import { shadowTemporalWgsl } from './shadowDenoiseTemporalWgsl.ts'
import {
  beginCamera,
  cameraSeen,
  NEVER_SEEN,
  NO_CAMERA,
  previousCameraOf,
} from '../../../frame/backend/state/previousCamera.ts'
import { viewKey } from '../../../frame/backend/state/viewKey.ts'

/** A light whose ray-traced shadow is denoised: its key (it keeps a history), its rank in the light buffer, the rect of the image it was traced over and is denoised over (the drawn image whole by default; a local light's screen rect), the layers its trace wrote (the visibility, which the result goes back into, and the distance of the nearest blocker), and, for a sun, the layer of the suns' mask the result is taken into. */
export interface ShadowDenoiseJob {
  key: string | number
  rank: number
  rect?: SelfShadowRect
  visibility: GPUTextureView
  hits: GPUTextureView
  sun?: { mask: GPUTextureView; slot: number }
}

const HISTORY_FORMAT = 'rgba16float'
const SIDE = SCREEN_SPACE_GROUP_SIDE
/** The spread of the first pre-convolution, in pixels (doubling with each). */
const PRE_CONVOLUTION_SPREAD = 8

/** The passes' stages and layouts, once a device. */
const stagesOf = oncePerDevice((device: GPUDevice) => {
  const make = layoutStagesOf(device, 'Trillion3D shadow denoise')
  const params = computeUniformEntry(D.params, { minBindingSize: DENOISE_PARAMS_BYTES })
  const source = (binding: number) => computeTextureEntry(binding, 'unfilterable-float')
  const shared = [
    ...inputEntries(GPUShaderStage.COMPUTE),
    params,
    computeBufferEntry(SD.lights, 'read-only-storage'),
  ]
  const out = computeStorageTextureEntry(B.out, HISTORY_FORMAT)
  const spatial = (name: string, kernel: 'reconstruct' | 'web' | 'postFilter', entry: string) =>
    make(
      name,
      device.createShaderModule({
        label: `Trillion3D shadow denoise ${name}`,
        code: shadowSpatialWgsl(kernel),
      }),
      entry,
      [...shared, source(D.sourceA), out],
    )
  return {
    injest: make(
      'injest',
      device.createShaderModule({
        label: 'Trillion3D shadow denoise injest',
        code: shadowInjestWgsl(),
      }),
      'shadowInjest',
      [...shared, source(D.sourceA), source(D.sourceB), out],
    ),
    reconstruct: spatial('reconstruction', 'reconstruct', 'shadowReconstruct'),
    web: spatial('pre-convolution', 'web', 'shadowPreConvolve'),
    postFilter: spatial('history convolution', 'postFilter', 'shadowPostFilter'),
    temporal: make(
      'temporal',
      device.createShaderModule({
        label: 'Trillion3D shadow denoise temporal',
        code: shadowTemporalWgsl(),
      }),
      'shadowTemporal',
      [
        ...shared,
        source(D.sourceA),
        source(D.historyA),
        source(D.prevDepth),
        source(D.prevNormals),
        out,
      ],
    ),
    final: make(
      'output',
      device.createShaderModule({
        label: 'Trillion3D shadow denoise output',
        code: shadowFinalWgsl(false),
      }),
      'shadowFinal',
      [params, source(D.sourceA), computeStorageTextureEntry(B.out, 'r32float')],
    ),
    finalSun: make(
      'sun output',
      device.createShaderModule({
        label: 'Trillion3D shadow denoise sun output',
        code: shadowFinalWgsl(true),
      }),
      'shadowFinal',
      [
        params,
        source(D.sourceA),
        computeStorageTextureEntry(B.out, 'r32float', 'read-write', '2d-array'),
      ],
    ),
  }
})

/** What a light keeps: its image last run and its runs (a parameter buffer each pass of an encode, so a light's bind groups name only its own buffers and another light appearing or leaving never remakes them). */
type LightCache = Runs & { used: number }

interface Texel {
  texture: GPUTexture
  view: GPUTextureView
}
export type History = {
  pair: [Texel, Texel]
  turn: number
  last: number
  used: number
  rect: SelfShadowRect
  /** What the first encode of image `frame` read of this history (`readOf`): every encoder of that image reads and writes the same sides, whether or not another was submitted before it encoded. */
  read?: { frame: number; turn: number; last: number; rect: SelfShadowRect }
}
/** The histories an encoder advanced and the image it ran in (the denoiser's `seen`/`revision` once it is submitted). */
interface Staged {
  histories: { held: History; frame: number; rect: SelfShadowRect }[]
  frame: number
  revision: number | undefined
  /** The drawn size of that image: the next reads its size change against it once the encoder is submitted. */
  size: [number, number]
}
/** What a view keeps (the images of one view, however many views share a device): the two textures the passes hand a sample to each other in, a texture the passes only bind as the scene colour (none writes it), the surface of the last images, a light's history (two textures, the one last written, the last image it ran in, the rect it was written over), the parameters of the image's passes (a buffer each) and their bind groups. All are made at the size the view's targets are allocated at. */
interface State {
  device: GPUDevice
  size: string
  work: [Texel, Texel]
  blank: Texel
  meta: DenoiseMeta
  histories: Map<string | number, History>
  /** What each light the denoiser ran for keeps: the image it was last run in and its bind groups (by pass and side; they name the light's own textures and the slot of its parameters). */
  lights: Map<string | number, LightCache>
  /** What the encoder last asked advanced, committed once that encoder is submitted (`commitOnSubmit`): an image encoded then dropped leaves it as it was. */
  staged?: { encoder: WeakRef<GPUCommandEncoder>; staged: Staged }
  /** The image the denoiser last ran in (`NEVER_SEEN` for none, the number `cameraSeen` asks the view's camera of the image before for) and the view's cut revision it saw. */
  seen: number
  revision: number | undefined
  /** What the image `image.frame` shares among its calls (one per sun pass and per local light), made at its first: whether the histories start again, what the last image left to reproject from
   *  (the view's camera of the image before, its drawn size, its pre-exposure) and the drawn size of the last image submitted (`size`, committed with it), which the next reads a size change by. */
  image: {
    frame: number
    cut: boolean
    lastRun: number
    previous: PreviousImage
    size: [number, number]
  }
}
const states = new WeakMap<object, State>()
/** The words a parameter buffer is written from (copied by the queue at the write). */
const paramWords = new Float32Array(DENOISE_PARAMS_WORDS)

const texel = (device: GPUDevice, label: string, size: readonly [number, number]): Texel => {
  const texture = device.createTexture({
    label,
    size: [size[0], size[1]],
    format: HISTORY_FORMAT,
    usage: loadOnlyUsage() | GPUTextureUsage.STORAGE_BINDING,
  })
  return { texture, view: texture.createView() }
}

/** The state of a view at the size its targets are allocated at, made again where that changed (the old one retired). */
function stateFor(gpu: WebgpuPagesRuntime['gpu'], device: GPUDevice): State {
  const size = gpu.allocatedSize
  const key = size.join('x')
  const held = states.get(viewKey(gpu))
  if (held?.size === key && held.device === device) return held
  // A resize remakes the textures only: the view uniform beside them (size independent) goes with the view or a replaced device.
  if (held && held.device !== device) releaseShadowDenoise(gpu, true)
  else releaseDenoiseState(gpu)
  const made: State = {
    device,
    size: key,
    work: [
      texel(device, 'Trillion3D shadow denoise work 0', size),
      texel(device, 'Trillion3D shadow denoise work 1', size),
    ],
    blank: texel(device, 'Trillion3D shadow denoise colour', [1, 1]),
    meta: createDenoiseMeta(device, size[0], size[1]),
    histories: new Map(),
    lights: new Map(),
    seen: NEVER_SEEN,
    revision: undefined,
    image: {
      frame: -2,
      cut: true,
      lastRun: NEVER_SEEN,
      previous: { viewProjection: NO_CAMERA.viewProjection, size: [1, 1], preExposure: 1 },
      size: [1, 1],
    },
  }
  states.set(viewKey(gpu), made)
  return made
}

/** What image `frame` reads of `held`: pinned at the image's first encode, so that a second encoder of the image, encoded after the first was submitted and advanced the turn, reads the history the first read and writes the one it wrote. */
export function readOf(held: History, frame: number) {
  if (held.read?.frame !== frame)
    held.read = { frame, turn: held.turn, last: held.last, rect: held.rect }
  return held.read
}

/** The encoder's share of what the denoiser advanced: made at the first ask, committed once that encoder is submitted (`commitOnSubmit`), never if it is dropped. */
function stagedOf(state: State, encoder: GPUCommandEncoder) {
  if (state.staged?.encoder.deref() === encoder) return state.staged.staged
  const staged: Staged = {
    histories: [],
    frame: state.seen,
    revision: state.revision,
    size: state.image.size,
  }
  state.staged = { encoder: new WeakRef(encoder), staged }
  commitOnSubmit(encoder, () => commit(state, staged))
  return staged
}

/** A history the encoder advanced, kept to become the one the next image reads once the encoder is submitted. */
function stage(
  state: State,
  encoder: GPUCommandEncoder,
  held: History,
  frame: number,
  rect: SelfShadowRect,
) {
  const { histories } = stagedOf(state, encoder)
  // A light staged twice (the image encoded again) advances once.
  const at = histories.findIndex((entry) => entry.held === held)
  if (at >= 0) histories[at] = { held, frame, rect }
  else histories.push({ held, frame, rect })
}

/** The encoder was submitted: the histories it advanced are the ones the next image reads, and the image it ran in is the one before for the next. */
function commit(state: State, staged: Staged) {
  for (const { held, frame, rect } of staged.histories) {
    // A light advances once an image: a second encoder of the same image that wrote it (both read the same turn) leaves the turn where the first put it.
    if (held.last !== frame) held.turn++
    held.last = frame
    held.rect = rect
  }
  state.seen = staged.frame
  state.revision = staged.revision
  state.image.size = staged.size
  if (state.staged?.staged === staged) state.staged = undefined
}

/** The shadow denoiser's textures, histories and parameter buffers of a view let go (retired; at once where the device was replaced), the view uniform beside them kept. */
function releaseDenoiseState(gpu: { viewKey?: object }, replaced = false) {
  const old = states.get(viewKey(gpu))
  if (!old) return
  states.delete(viewKey(gpu))
  const textures = [
    ...old.work.map((w) => w.texture),
    old.blank.texture,
    ...[...old.histories.values()].flatMap((h) => h.pair.map((p) => p.texture)),
  ]
  retire(
    old.device,
    {
      destroy: () => {
        for (const t of textures) t.destroy()
        old.meta.destroy()
      },
    },
    replaced,
  )
  for (const light of old.lights.values()) light.uniforms.release(old.device, replaced)
}

/** The shadow denoiser of a view let go whole: its state and the view uniform beside it (retired; at once where the device was replaced). */
export function releaseShadowDenoise(gpu: { viewKey?: object }, replaced = false) {
  if (!states.has(viewKey(gpu))) return
  releaseBesideInputs(gpu, 'kept', replaced)
  releaseDenoiseState(gpu, replaced)
}

/** What a view lets go of while its denoiser is idle: the histories and bind groups of the lights unseen for `IDLE_KEEP_IMAGES` images (the whole state goes with the view's rays, `trimRayTraced`). Every image the rays run, whether or not a light is denoised in it. */
export function trimShadowDenoise(gpu: { viewKey?: object }, frame: number) {
  const state = states.get(viewKey(gpu))
  if (!state) return
  for (const [key, held] of state.histories)
    if (idleTooLong(frame, held.used)) {
      state.histories.delete(key)
      retire(state.device, { destroy: () => held.pair.forEach((p) => p.texture.destroy()) })
    }
  // The bind groups of a light unseen as long go with it (they are made again where a pass needs them).
  for (const [key, light] of state.lights)
    if (idleTooLong(frame, light.used)) {
      light.uniforms.release(state.device)
      state.lights.delete(key)
    }
}

/** What the image shares among the denoiser's calls, made at the first, at encode (the view's camera of the image before is the history's where the denoiser ran in that image, else the histories start again). */
function beginImage(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  state: State,
  target: readonly [number, number],
) {
  const { image } = state
  const frame = rt.run.frame
  if (image.frame === frame) return image
  beginCamera(rt, cam)
  // The denoiser's own last image is the one before for it, however many still images were held between (a held image draws nothing and moves nothing): the history is whole where
  // that image is the last the view's camera was kept for and its surface was kept (submitted).
  const before = cameraSeen(previousCameraOf(rt), state.seen)
  const size: [number, number] = [target[0], target[1]]
  image.cut =
    !before ||
    state.revision !== rt.run.gate.temporalRevision ||
    state.meta.keptFrame !== state.seen
  image.lastRun = state.seen
  image.previous = {
    viewProjection: (before ?? NO_CAMERA).viewProjection,
    size: before ? image.size : size,
    preExposure: preExposureOf(rt).previous,
  }
  image.frame = frame
  return image
}

/** The buffer of the light's next pass, written with `fields`: one a pass, since the passes are encoded before any is submitted. */
function paramsFor(
  device: GPUDevice,
  light: LightCache,
  encoder: GPUCommandEncoder,
  fields: Parameters<typeof writeDenoiseParams>[1],
) {
  const params = light.uniforms.next(device, encoder)
  writeDenoiseParams(paramWords, fields)
  device.queue.writeBuffer(params.buffer, 0, paramWords)
  return params
}

/** The history of a light at the size the view's targets are allocated at, made where it has none. */
function historyFor(
  device: GPUDevice,
  state: State,
  key: string | number,
  size: readonly [number, number],
  rect: SelfShadowRect,
) {
  let held = state.histories.get(key)
  if (!held) {
    held = {
      rect,
      pair: [
        texel(device, 'Trillion3D shadow denoise history 0', size),
        texel(device, 'Trillion3D shadow denoise history 1', size),
      ],
      turn: 0,
      last: -2,
      used: 0,
    }
    state.histories.set(key, held)
  }
  return held
}

/** The pipelines of every pass of the denoiser and of the pass that keeps the surface for the next image, once a device. */
const pipelinesOf = oncePerDevice((device: GPUDevice) => [
  ...Object.values(stagesOf(device)).map((stage) => stage.pipeline),
  denoiseKeepPipeline(device),
])

/** What the denoiser needs of the view this image, nothing made: the device, the light buffer, and the frame's inputs held (`screenSpaceFrameReady`). The one place the readiness is decided. */
function held(rt: WebgpuPagesRuntime) {
  const { device } = rt.gpu
  const lights = rt.lights.buffer
  return device && lights && screenSpaceFrameReady(rt) ? { device, lights } : undefined
}

/** What a denoiser run of this image holds: the view's state, the image's shared part, the frame's inputs and the light buffer; made at encode, never to ask whether it can run. */
function prepare(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const ready = held(rt)
  if (!ready) return undefined
  const { device, lights } = ready
  const state = stateFor(rt.gpu, device)
  const image = beginImage(rt, cam, state, rt.gpu.targetSize)
  const inputs = screenSpaceFrameInputs(rt, device, cam, image.previous)
  return inputs && { device, state, image, inputs, lights }
}

/** Whether the denoiser runs on this image, decided once for it: its inputs held and every one of its passes compiled (the missing ones asked, the frames wait for them); `encodeShadowDenoise` then encodes every job it is given. A light that needs its result must keep its undenoised path where it is not. Allocates nothing: the state is made at encode. */
export const shadowDenoiseReady = (rt: WebgpuPagesRuntime) => {
  const ready = held(rt)
  return !!ready && chainReady(...pipelinesOf(ready.device))
}

/**
 * THE SHADOW DENOISER of the ray-traced shadows of `jobs` (a light each, the reference's default denoiser run light by light): for each, the trace's visibility and nearest-blocker distance become samples
 * (injestion), the reconstruction takes them in the quad-shared stochastic sets, the pre-convolutions in a web, the accumulation in time blends them with the light's history (kept from image to image),
 * an optional convolution of the history runs, and the share that arrived goes back into the visibility's layer (a sun's, into its layer of the suns' mask by the minimum). The caller has asked
 * `shadowDenoiseReady` for the image (the inputs of the frame held, no pass compiling), so every job is encoded; the histories, and the image the next reprojects from, advance once the encoder is submitted (`commitOnSubmit`).
 */
export function encodeShadowDenoise(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  settings: ShadowValues,
  jobs: readonly ShadowDenoiseJob[],
) {
  const frame = rt.run.frame
  const prepared = jobs.length ? prepare(rt, cam) : undefined
  if (!prepared) return
  const { device, state, image, inputs, lights } = prepared
  const target = rt.gpu.targetSize
  const stages = stagesOf(device)
  const whole = [0, 0, target[0], target[1]] as const
  // The history reprojects with the camera of the image the denoiser itself last ran in: none, or one that is not the image before or whose view was cut since, leaves nothing to reproject from.
  // The same for every call of the image (the sun passes and each local light run one after the other), but for a cut of the temporal histories between two of them.
  const cut = image.cut || state.revision !== rt.run.gate.temporalRevision
  encodeDenoiseKeep(
    device,
    encoder,
    state.meta,
    inputs,
    state.blank.view,
    frame,
    target[0],
    target[1],
  )
  const base = {
    width: target[0],
    height: target[1],
    previousWidth: image.previous.size[0],
    previousHeight: image.previous.size[1],
    ratio: 1,
    maxSamples: settings.rayTracedShadowsDenoiserReconstructionSamples,
    previousCumulative: 1,
    spread: 1,
    frame: noiseFrame(rt) % 8,
    exposure: 1,
  }
  // The light being denoised and which of its two histories it reads this image: its bind groups are kept per pass and side.
  let cache!: LightCache
  let side = 0
  // The rect the light works over this image and the one its history was written over (the passes dispatch over the first).
  let rect: SelfShadowRect = whole
  let lastRect: SelfShadowRect = whole
  const run = (
    stage: { layout: GPUBindGroupLayout; pipeline: Parameters<typeof dispatchOn>[1] },
    label: string,
    fields: Partial<Parameters<typeof writeDenoiseParams>[1]> & { light?: number; slot?: number },
    entries: GPUBindGroupEntry[],
    withInputs: boolean,
    color: GPUTextureView,
  ) => {
    const params = paramsFor(device, cache, encoder, {
      ...base,
      cut: false,
      rect,
      lastRect,
      ...fields,
    })
    const group = groupFor(
      device,
      cache.groups,
      `${label}:${side}`,
      stage.layout,
      [
        params.buffer,
        ...(withInputs ? [...inputDeps(inputs, color), lights] : []),
        ...entries.map((entry) => entry.resource),
      ],
      () => [
        ...(withInputs ? sceneEntries(inputs, color, lights) : []),
        {
          binding: D.params,
          resource: { buffer: params.buffer, size: DENOISE_PARAMS_BYTES },
        },
        ...entries,
      ],
    )
    const pass = encoder.beginComputePass({ label: `Trillion3D shadow denoise ${label}` })
    dispatchOn(
      pass,
      stage.pipeline,
      group,
      Math.max(1, ceilDiv(rect[2] - rect[0], SIDE)),
      Math.max(1, ceilDiv(rect[3] - rect[1], SIDE)),
    )
    pass.end()
  }
  const read = (binding: number, view: GPUTextureView) => ({ binding, resource: view })
  for (const job of jobs) {
    const accumulate = settings.rayTracedShadowsDenoiserTemporalAccumulation
    rect = clampRect(job.rect ?? whole, target)
    cache = state.lights.get(job.key) ?? {
      used: frame,
      ...createRuns('Trillion3D shadow denoise parameters', DENOISE_PARAMS_BYTES, namedGroups()),
    }
    cache.used = frame
    state.lights.set(job.key, cache)
    const history = accumulate
      ? historyFor(device, state, job.key, rt.gpu.allocatedSize, rect)
      : undefined
    const pinned = history && readOf(history, frame)
    lastRect = pinned?.rect ?? rect
    if (history) history.used = frame
    const turn = pinned?.turn ?? 0
    side = turn % 2
    const fresh = cut || pinned?.last !== image.lastRun
    const color = state.blank.view
    let at = 0
    const other = () => 1 - at
    const light = { light: job.rank }
    run(
      stages.injest,
      'injest',
      light,
      [
        read(D.sourceA, job.visibility),
        read(D.sourceB, job.hits),
        { binding: B.out, resource: state.work[0].view },
      ],
      true,
      color,
    )
    run(
      stages.reconstruct,
      'reconstruction',
      { ...light, spread: 1 },
      [read(D.sourceA, state.work[0].view), { binding: B.out, resource: state.work[1].view }],
      true,
      color,
    )
    at = 1
    for (let p = 0; p < settings.rayTracedShadowsDenoiserPreConvolution; p++) {
      run(
        stages.web,
        `pre-convolution ${p}`,
        { ...light, spread: PRE_CONVOLUTION_SPREAD * (1 << p) },
        [
          read(D.sourceA, state.work[at].view),
          { binding: B.out, resource: state.work[other()].view },
        ],
        true,
        color,
      )
      at = other()
    }
    let result = state.work[at].view
    const convolve = settings.rayTracedShadowsDenoiserHistoryConvolutionSamples > 1
    if (history) {
      const read0 = history.pair[turn % 2]!
      const write = convolve ? state.work[other()] : history.pair[(turn + 1) % 2]!
      const slot = previousSlot(state.meta, frame)
      run(
        stages.temporal,
        'temporal',
        { ...light, cut: fresh },
        [
          read(D.sourceA, result),
          read(D.historyA, read0.view),
          read(D.prevDepth, state.meta.depthViews[slot]!),
          read(D.prevNormals, state.meta.normalViews[slot]!),
          { binding: B.out, resource: write.view },
        ],
        true,
        color,
      )
      result = write.view
    }
    if (convolve) {
      const write = history ? history.pair[(turn + 1) % 2]! : state.work[other()]
      run(
        stages.postFilter,
        'history convolution',
        {
          ...light,
          maxSamples: settings.rayTracedShadowsDenoiserHistoryConvolutionSamples,
          spread: 1,
        },
        [read(D.sourceA, result), { binding: B.out, resource: write.view }],
        true,
        color,
      )
      result = write.view
    }
    if (history) stage(state, encoder, history, frame, rect)
    if (job.sun)
      run(
        stages.finalSun,
        'sun output',
        { slot: job.sun.slot },
        [read(D.sourceA, result), { binding: B.out, resource: job.sun.mask }],
        false,
        color,
      )
    else
      run(
        stages.final,
        'output',
        {},
        [read(D.sourceA, result), { binding: B.out, resource: job.visibility }],
        false,
        color,
      )
  }
  // This image is the one the next reprojects from.
  const staged = stagedOf(state, encoder)
  staged.frame = frame
  staged.revision = rt.run.gate.temporalRevision
  staged.size = [target[0], target[1]]
}

/** `rect` kept inside the drawn image, at least one texel wide and high. */
const clampRect = (rect: SelfShadowRect, target: readonly [number, number]): SelfShadowRect => {
  const x0 = clamp(Math.floor(rect[0]), 0, target[0] - 1)
  const y0 = clamp(Math.floor(rect[1]), 0, target[1] - 1)
  return [
    x0,
    y0,
    clamp(Math.ceil(rect[2]), x0 + 1, target[0]),
    clamp(Math.ceil(rect[3]), y0 + 1, target[1]),
  ]
}

/** The entries of the screen-space group's inputs and of the light buffer. */
const sceneEntries = (inputs: ScreenSpaceInputs, color: GPUTextureView, lights: GPUBuffer) => [
  ...inputGroupEntries(inputs, color),
  { binding: SD.lights, resource: { buffer: lights } },
]
