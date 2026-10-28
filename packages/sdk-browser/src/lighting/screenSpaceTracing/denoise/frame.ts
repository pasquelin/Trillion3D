import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { dispatchOn } from '../../../gpu/core/computeStages.ts'
import { SCREEN_SPACE_BINDINGS as B } from '../rayCastWgsl.ts'
import { SCREEN_SPACE_GROUP_SIDE } from '../screenSpaceQuality.ts'
import { groupFor, inputDeps, inputGroupEntries, type ScreenSpaceInputs } from '../frame.ts'
import {
  DENOISE_BINDINGS as D,
  DENOISE_PARAMS_BYTES,
  DENOISE_PARAMS_WORDS,
  writeDenoiseParams,
} from './denoiseView.ts'
import {
  DENOISE_FORMAT_A,
  DENOISE_FORMAT_B,
  denoiseAccumulationPipeline,
  denoiseKeepPipeline,
  denoiseLayouts,
  denoiseSpatialPipeline,
} from './pipelines.ts'
import type { DenoiseSignal } from './signalWgsl.ts'

/** Read at the call: Node has no WebGPU global at the load of a module. */
const sampledStored = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
/** The bytes between two passes' parameters in the buffer that holds them (a uniform offset's alignment). */
const PARAMS_STRIDE = 256
/** The parameters' slots: the reconstruction, the pre-convolutions (at most four), the accumulation. */
const MAX_PRE_CONVOLUTIONS = 4
const ACCUMULATION_SLOT = 1 + MAX_PRE_CONVOLUTIONS

/** A signal in two textures: the colour (and what rides with it) and the pair of numbers. */
export interface DenoiseSource {
  a: GPUTextureView
  b: GPUTextureView
}

interface DenoiseSet extends DenoiseSource {
  textures: GPUTexture[]
}

const makeSet = (device: GPUDevice, label: string, width: number, height: number): DenoiseSet => {
  const a = device.createTexture({
    label: `Trillion3D screen space denoise ${label} A`,
    size: [width, height],
    format: DENOISE_FORMAT_A,
    usage: sampledStored(),
  })
  const b = device.createTexture({
    label: `Trillion3D screen space denoise ${label} B`,
    size: [width, height],
    format: DENOISE_FORMAT_B,
    usage: sampledStored(),
  })
  return { a: a.createView(), b: b.createView(), textures: [a, b] }
}

/** What the denoiser keeps of a signal at a grid of `width × height` texels, `ratio` pixels of the view to a texel: the textures the spatial passes write (a second one
 *  once a second pass needs it), the two histories (once an accumulation runs), the parameters of every pass, the bind groups. */
export function createDenoiseSignal(
  device: GPUDevice,
  signal: DenoiseSignal,
  width: number,
  height: number,
  ratio: 1 | 2,
) {
  const grid = [ceilDiv(width, ratio), ceilDiv(height, ratio)] as const
  const sets: Record<string, DenoiseSet | undefined> = {}
  const set = (name: string) =>
    (sets[name] ??= makeSet(device, `${signal} ${name}`, grid[0], grid[1]))
  const params = device.createBuffer({
    label: `Trillion3D screen space denoise ${signal} parameters`,
    size: PARAMS_STRIDE * (ACCUMULATION_SLOT + 1),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return {
    signal,
    grid,
    ratio,
    params,
    words: new Float32Array(DENOISE_PARAMS_WORDS),
    groups: new Map<string, { deps: readonly unknown[]; group: GPUBindGroup }>(),
    set,
    /** The image the history was last accumulated in, and the count of accumulations (which history is read, which written). */
    lastFrame: -2,
    turn: 0,
    destroy() {
      for (const made of Object.values(sets)) for (const t of made?.textures ?? []) t.destroy()
      params.destroy()
    },
  }
}
export type DenoiseSignalState = ReturnType<typeof createDenoiseSignal>

/** The surface of the last two images (depth, then normal with the roughness), one slot for each, kept for the accumulation to compare with. */
export function createDenoiseMeta(device: GPUDevice, width: number, height: number) {
  const make = (label: string, format: GPUTextureFormat) =>
    [0, 1].map((slot) =>
      device.createTexture({
        label: `Trillion3D screen space denoise kept ${label} ${slot}`,
        size: [width, height],
        format,
        usage: sampledStored(),
      }),
    )
  const depth = make('depth', 'r32float')
  const normals = make('normals', 'rgba16float')
  return {
    depth,
    normals,
    depthViews: depth.map((t) => t.createView()),
    normalViews: normals.map((t) => t.createView()),
    groups: new Map<string, { deps: readonly unknown[]; group: GPUBindGroup }>(),
    /** The image whose surface was kept last, and the one kept before it. */
    keptFrame: -2,
    previousKept: -2,
    destroy() {
      for (const t of [...depth, ...normals]) t.destroy()
    },
  }
}
export type DenoiseMeta = ReturnType<typeof createDenoiseMeta>

/** How an image runs the denoiser: the most samples of the reconstruction, the pre-convolutions, whether the result accumulates, the image's number (to tell a
 *  gap in the images), whether the view's history is dropped (a camera cut), its noise frame and the exposure of its signal. */
export interface DenoiseRun {
  samples: number
  preConvolution: number
  temporal: boolean
  frame: number
  cut: boolean
  noiseFrame: number
  exposure: number
}

/** Whether the surface of the image before `frame` is held: kept last, or, the image's own having been kept since, before that. */
const holdsPrevious = (meta: DenoiseMeta, frame: number) =>
  meta.keptFrame === frame - 1 || (meta.keptFrame === frame && meta.previousKept === frame - 1)

/** The kept surface a run compares with: the last image's slot, whose depth and normals are read. */
const previousSlot = (frame: number) => (frame + 1) % 2

/** What the passes of a signal's denoiser share: the device and encoder, the signal's state, the trace's inputs, the image they bind and the run. */
interface DenoisePassContext {
  device: GPUDevice
  encoder: GPUCommandEncoder
  state: DenoiseSignalState
  inputs: ScreenSpaceInputs
  color: GPUTextureView
  run: DenoiseRun
}

/** One pass of the denoiser: its parameters slot, label, stage and layout, what it reads and writes, its parameters' own fields and the bindings it adds. */
interface DenoisePassSpec {
  slot: number
  label: string
  stage: ReturnType<typeof denoiseSpatialPipeline>
  layout: GPUBindGroupLayout
  read: DenoiseSource
  write: DenoiseSource
  fields: { previousCumulative: number; cut: boolean }
  extra?: { deps: readonly unknown[]; entries: GPUBindGroupEntry[] }
}

/** Writes the parameters of a pass into its slot, binds its group and dispatches it over the signal's grid; returns what it wrote. */
function encodeDenoisePass(c: DenoisePassContext, spec: DenoisePassSpec) {
  const { device, encoder, state, inputs, color, run } = c
  const { slot, label, read, write, fields } = spec
  const extra = spec.extra ?? { deps: [], entries: [] }
  const [gridWidth, gridHeight] = state.grid
  writeDenoiseParams(state.words, {
    width: gridWidth,
    height: gridHeight,
    ratio: state.ratio,
    cut: fields.cut,
    maxSamples: run.samples,
    previousCumulative: fields.previousCumulative,
    spread: 1,
    frame: run.noiseFrame,
    exposure: run.exposure,
  })
  device.queue.writeBuffer(state.params, slot * PARAMS_STRIDE, state.words)
  const group = groupFor(
    device,
    state,
    `${state.signal}${slot}:${label}`,
    spec.layout,
    [...inputDeps(inputs, color), read.a, read.b, write.a, write.b, ...extra.deps],
    () => [
      ...inputGroupEntries(inputs, color),
      {
        binding: D.params,
        resource: {
          buffer: state.params,
          offset: slot * PARAMS_STRIDE,
          size: DENOISE_PARAMS_BYTES,
        },
      },
      { binding: D.sourceA, resource: read.a },
      { binding: D.sourceB, resource: read.b },
      { binding: B.out, resource: write.a },
      { binding: B.outSecond, resource: write.b },
      ...extra.entries,
    ],
  )
  const encoded = encoder.beginComputePass({ label: `Trillion3D screen space denoise ${label}` })
  dispatchOn(
    encoded,
    spec.stage,
    group,
    ceilDiv(gridWidth, SCREEN_SPACE_GROUP_SIDE),
    ceilDiv(gridHeight, SCREEN_SPACE_GROUP_SIDE),
  )
  encoded.end()
  return write
}

/** The accumulation in time of `current` with the signal's history, written into the other history; the surface kept at the last image is read. */
function encodeAccumulation(
  c: DenoisePassContext,
  meta: DenoiseMeta,
  current: DenoiseSource,
): DenoiseSource {
  const { device, state, run } = c
  const history = state.lastFrame === run.frame - 1 && holdsPrevious(meta, run.frame)
  const read = state.set(`history${state.turn % 2}`)
  const write = state.set(`history${(state.turn + 1) % 2}`)
  const slot = previousSlot(run.frame)
  const result = encodeDenoisePass(c, {
    slot: ACCUMULATION_SLOT,
    label: 'accumulation',
    stage: denoiseAccumulationPipeline(device, state.signal),
    layout: denoiseLayouts(device).accumulation,
    read: current,
    write,
    fields: { previousCumulative: 1, cut: run.cut || !history },
    extra: {
      deps: [read.a, read.b, meta.depthViews[slot], meta.normalViews[slot]],
      entries: [
        { binding: D.historyA, resource: read.a },
        { binding: D.historyB, resource: read.b },
        { binding: D.prevDepth, resource: meta.depthViews[slot] },
        { binding: D.prevNormals, resource: meta.normalViews[slot] },
      ],
    },
  })
  state.turn++
  state.lastFrame = run.frame
  return result
}

/**
 * THE DENOISER OF A SIGNAL: the reconstruction of `source` (as the trace wrote it), then the pre-convolutions, then, when the run accumulates, the accumulation in
 * time with the signal's history; returns the textures that hold the result. `color` is any sampled float texture (the passes bind the trace's inputs, which hold one).
 */
export function encodeDenoise(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: DenoiseSignalState,
  meta: DenoiseMeta,
  inputs: ScreenSpaceInputs,
  color: GPUTextureView,
  source: DenoiseSource,
  run: DenoiseRun,
): DenoiseSource {
  const context: DenoisePassContext = { device, encoder, state, inputs, color, run }
  const layouts = denoiseLayouts(device)
  const preConvolutions = Math.min(
    Math.max(Math.trunc(run.preConvolution), 0),
    MAX_PRE_CONVOLUTIONS,
  )
  let current = encodeDenoisePass(context, {
    slot: 0,
    label: 'reconstruction',
    stage: denoiseSpatialPipeline(device, state.signal, 'input'),
    layout: layouts.spatial,
    read: source,
    write: state.set('spatial0'),
    fields: { previousCumulative: 1, cut: false },
  })
  for (let p = 0; p < preConvolutions; p++) {
    current = encodeDenoisePass(context, {
      slot: 1 + p,
      label: `pre-convolution ${p}`,
      stage: denoiseSpatialPipeline(device, state.signal, 'history'),
      layout: layouts.spatial,
      read: current,
      write: state.set(p % 2 === 0 ? 'spatial1' : 'spatial0'),
      fields: { previousCumulative: Math.pow(run.samples, 1 + p), cut: false },
    })
  }
  return run.temporal ? encodeAccumulation(context, meta, current) : current
}

/**
 * THE SURFACE OF THIS IMAGE KEPT for the next image's accumulation, once an image: the first signal to ask writes it, the others find it done.
 */
export function encodeDenoiseKeep(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  meta: DenoiseMeta,
  inputs: ScreenSpaceInputs,
  color: GPUTextureView,
  frame: number,
  width: number,
  height: number,
) {
  if (meta.keptFrame === frame) return
  const slot = frame % 2
  const group = groupFor(
    device,
    meta,
    `keep${slot}`,
    denoiseLayouts(device).keep,
    [...inputDeps(inputs, color), meta.depthViews[slot], meta.normalViews[slot]],
    () => [
      ...inputGroupEntries(inputs, color),
      { binding: D.keepDepth, resource: meta.depthViews[slot] },
      { binding: D.keepNormals, resource: meta.normalViews[slot] },
    ],
  )
  const pass = encoder.beginComputePass({ label: 'Trillion3D screen space denoise keep' })
  dispatchOn(
    pass,
    denoiseKeepPipeline(device),
    group,
    ceilDiv(width, SCREEN_SPACE_GROUP_SIDE),
    ceilDiv(height, SCREEN_SPACE_GROUP_SIDE),
  )
  pass.end()
  meta.previousKept = meta.keptFrame
  meta.keptFrame = frame
}
