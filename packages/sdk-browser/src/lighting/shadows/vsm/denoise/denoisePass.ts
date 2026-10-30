/**
 * Host side of the shadow mask denoise (`denoiseWgsl.ts`, `shadowDenoise`): which passes it runs
 * (`denoisePasses`), the bindings and pipelines of its kernels, the uniform ring its passes read at a dynamic
 * offset each (a frame's passes are all encoded before the queue runs them, so each has a slot of its own),
 * and the scratch textures it alternates with the masks. The masks are filtered in place by value: the
 * passes go mask → scratch → mask, an odd count beginning with a copy, so that the last one writes the mask.
 * The suns' and the local lights' masks are filtered once the projection and the shadows laid into them are
 * written (`denoiseProjected`); each per-light layer, once its light's projection and the shadows added to it are
 * (`denoiseLayer`).
 */
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { arrayView } from '../../../../gpu/core/textureViews.ts'
import { VSM_DENOISE_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { chainReady, preparedComputePipeline } from '../../../deferred/fullscreen.ts'
import type { PreparedPipeline } from '../../../deferred/fullscreen.ts'
import {
  DENOISE_BINDING,
  DENOISE_FORMAT,
  DENOISE_GROUP,
  DENOISE_PARAM_WORDS,
  vsmDenoiseWgsl,
  type DenoiseKind,
} from './denoiseWgsl.ts'

const STEP: GPUComputePassDescriptor = { label: VSM_DENOISE_PASS }
/** The passes a frame may encode: a slot of the uniform ring each; past them a mask is left as it is. */
const RING_SLOTS = 1024

/** The camera and the target the geometry weights reconstruct pixels with. */
export interface DenoiseView {
  /** World → view, column-major (−Z forward). */
  view: ArrayLike<number>
  /** View → clip, column-major, reverse-Z. */
  projection: ArrayLike<number>
  /** The size the view is drawn at. */
  width: number
  height: number
  /** The image's depth (depth32float) and normals (xyz = world normal). */
  depth: GPUTextureView
  normals: GPUTextureView
}

/** The passes a frame's denoise runs for `iterations` filter passes: those, and the copy an odd count begins with (0 passes for 0). */
export const denoisePasses = (iterations: number) =>
  iterations <= 0 ? 0 : iterations + (iterations & 1)

/** The words of one slot of the uniform: `DenoiseParams` (`denoiseWgsl.ts`), for the pass `pass` of `iterations` over `rect`. */
export function writeDenoiseParams(
  into: Float32Array,
  view: DenoiseView,
  rect: readonly [number, number, number, number],
  iterations: number,
  pass: number,
) {
  const { projection: P, view: V } = view
  const ints = new Int32Array(into.buffer, into.byteOffset, 4)
  ints.set(rect)
  into[4] = P[10]
  into[5] = P[14]
  into[6] = P[11]
  into[7] = P[15]
  into[8] = P[0]
  into[9] = P[5]
  into[10] = 2 / view.width
  into[11] = 2 / view.height
  // The rotation's rows: world → view is the upper 3x3 of the column-major view matrix.
  for (let r = 0; r < 3; r++) {
    into[12 + 4 * r] = V[r]
    into[13 + 4 * r] = V[4 + r]
    into[14 + 4 * r] = V[8 + r]
    into[15 + 4 * r] = 0
  }
  const copy = iterations & 1 && pass === 0
  const step = 2 ** (pass - (iterations & 1))
  into[24] = copy ? 0 : step
  into[25] = copy ? 1 : 0
  into[26] = 0
  into[27] = 0
}

interface Pipes {
  layout: GPUBindGroupLayout
  pipeline: PreparedPipeline<GPUComputePipeline>
}

const pipelines = oncePerDevice(() => new Map<DenoiseKind, Pipes>())

const sourceEntry = (kind: DenoiseKind) =>
  computeTextureEntry(
    DENOISE_BINDING.source,
    kind.endsWith('uint') ? 'uint' : 'unfilterable-float',
    kind === 'sun' ? '2d-array' : '2d',
  )

function pipesOf(device: GPUDevice, kind: DenoiseKind): Pipes {
  const byKind = pipelines(device)
  let made = byKind.get(kind)
  if (made) return made
  const layout = device.createBindGroupLayout({
    label: `${VSM_DENOISE_PASS}.${kind}`,
    entries: [
      computeUniformEntry(DENOISE_BINDING.params, { hasDynamicOffset: true }),
      computeTextureEntry(DENOISE_BINDING.depth, 'depth'),
      computeTextureEntry(DENOISE_BINDING.normals, 'unfilterable-float'),
      sourceEntry(kind),
      computeStorageTextureEntry(
        DENOISE_BINDING.result,
        DENOISE_FORMAT[kind],
        'write-only',
        kind === 'sun' ? '2d-array' : '2d',
      ),
    ],
  })
  made = {
    layout,
    pipeline: preparedComputePipeline(device, {
      label: `${VSM_DENOISE_PASS}.${kind}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: {
        module: device.createShaderModule({
          label: `${VSM_DENOISE_PASS}.${kind}`,
          code: vsmDenoiseWgsl(kind),
        }),
        entryPoint: 'vsmDenoise',
      },
    }),
  }
  byKind.set(kind, made)
  return made
}

interface Scratch {
  texture: GPUTexture
  view: GPUTextureView
  width: number
  height: number
  layers: number
}

/** What a device keeps: the uniform ring and the next slot, the scratch of each kind. */
interface DenoiseState {
  ring: GPUBuffer
  stride: number
  slot: number
  scratch: Map<DenoiseKind, Scratch>
}

const states = new WeakMap<GPUDevice, DenoiseState>()
const words = new Float32Array(DENOISE_PARAM_WORDS)

function stateOf(device: GPUDevice) {
  let state = states.get(device)
  if (!state) {
    const align = device.limits.minUniformBufferOffsetAlignment
    const stride = Math.ceil((DENOISE_PARAM_WORDS * 4) / align) * align
    state = {
      ring: device.createBuffer({
        label: `${VSM_DENOISE_PASS}.params`,
        size: stride * RING_SLOTS,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      stride,
      slot: 0,
      scratch: new Map(),
    }
    states.set(device, state)
  }
  return state
}

/** A new frame: the ring's slots are free again. */
export function beginDenoiseFrame(device: GPUDevice) {
  const state = states.get(device)
  if (state) state.slot = 0
}

/** Lets the scratch textures go, where the denoise is off: it holds nothing then. */
export function releaseDenoise(device: GPUDevice) {
  const state = states.get(device)
  if (!state?.scratch.size) return
  for (const held of state.scratch.values()) retire(device, held.texture)
  state.scratch.clear()
}

function scratchOf(
  device: GPUDevice,
  state: DenoiseState,
  kind: DenoiseKind,
  width: number,
  height: number,
  layers: number,
) {
  const held = state.scratch.get(kind)
  if (held && held.width === width && held.height === height && held.layers === layers) return held
  if (held) retire(device, held.texture)
  const texture = device.createTexture({
    label: `${VSM_DENOISE_PASS}.scratch.${kind}`,
    size: [width, height, kind === 'sun' ? layers : 1],
    format: DENOISE_FORMAT[kind],
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const made = {
    texture,
    view: kind === 'sun' ? arrayView(texture) : texture.createView(),
    width,
    height,
    layers,
  }
  state.scratch.set(kind, made)
  return made
}

/** The mask a filter runs on: its view, the size of its texture, the layers of a suns' array. */
export interface DenoiseTarget {
  kind: DenoiseKind
  view: GPUTextureView
  width: number
  height: number
  layers: number
}

/** The compiles of the kernels of `kinds`, started ahead of the frames that run them (`prepare`). */
export const prepareDenoise = (device: GPUDevice, kinds: readonly DenoiseKind[]) =>
  kinds.map((kind) => pipesOf(device, kind).pipeline.prepare().then(() => undefined))

/** Whether the kernel of `kind` is compiled (the denoise waits for it; the masks stay as written meanwhile). */
export const denoiseReady = (device: GPUDevice, kind: DenoiseKind) =>
  chainReady(pipesOf(device, kind).pipeline)

/**
 * Encodes the passes of `iterations` over `rect` of `target` into `pass`, reading `view`'s depth and normals. Nothing is encoded where the ring
 * holds too few slots or the kernel is compiling; whether it was.
 */
function dispatchPasses(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  target: DenoiseTarget,
  view: DenoiseView,
  rect: readonly [number, number, number, number],
  iterations: number,
) {
  const count = denoisePasses(iterations)
  const state = stateOf(device)
  if (!count || state.slot + count > RING_SLOTS) return false
  if (!denoiseReady(device, target.kind)) return false
  const { layout, pipeline } = pipesOf(device, target.kind)
  const scratch = scratchOf(device, state, target.kind, target.width, target.height, target.layers)
  const group = (from: GPUTextureView, into: GPUTextureView) =>
    device.createBindGroup({
      label: `${VSM_DENOISE_PASS}.${target.kind}`,
      layout,
      entries: [
        { binding: DENOISE_BINDING.params, resource: { buffer: state.ring, size: DENOISE_PARAM_WORDS * 4 } },
        { binding: DENOISE_BINDING.depth, resource: view.depth },
        { binding: DENOISE_BINDING.normals, resource: view.normals },
        { binding: DENOISE_BINDING.source, resource: from },
        { binding: DENOISE_BINDING.result, resource: into },
      ],
    })
  const forward = group(target.view, scratch.view),
    back = group(scratch.view, target.view)
  const groupsX = ceilDiv(rect[2] - rect[0], DENOISE_GROUP),
    groupsY = ceilDiv(rect[3] - rect[1], DENOISE_GROUP)
  pass.setPipeline(pipeline.get()!)
  for (let k = 0; k < count; k++) {
    writeDenoiseParams(words, view, rect, iterations, k)
    device.queue.writeBuffer(state.ring, state.slot * state.stride, words)
    pass.setBindGroup(0, k & 1 ? back : forward, [state.slot * state.stride])
    pass.dispatchWorkgroups(groupsX, groupsY, target.kind === 'sun' ? target.layers : 1)
    state.slot++
  }
  return true
}

/** The suns' mask (the first `suns` layers of `sunsView`) and, where there are any, the local lights' packed mask of `localFormat`, filtered in the frame's compute run. */
export function denoiseProjected(
  device: GPUDevice,
  steps: ComputeRun,
  view: DenoiseView,
  iterations: number,
  masks: {
    suns: GPUTexture
    sunsView: GPUTextureView
    sunCount: number
    locals?: GPUTexture
    localsView?: GPUTextureView
    localFormat: 'r32uint' | 'rg32uint' | 'rgba32uint'
  },
) {
  // No pass: nothing is opened, nothing is encoded, the masks are as the projection wrote them.
  if (!denoisePasses(iterations)) return
  const rect = [0, 0, view.width, view.height] as const
  const pass = () => steps.pass(STEP)
  if (masks.sunCount > 0)
    dispatchPasses(
      device,
      pass(),
      {
        kind: 'sun',
        view: masks.sunsView,
        width: masks.suns.width,
        height: masks.suns.height,
        layers: masks.suns.depthOrArrayLayers,
      },
      view,
      rect,
      iterations,
    )
  if (masks.locals && masks.localsView)
    dispatchPasses(
      device,
      pass(),
      {
        kind: masks.localFormat,
        view: masks.localsView,
        width: masks.locals.width,
        height: masks.locals.height,
        layers: 1,
      },
      view,
      rect,
      iterations,
    )
}

/** The per-light layer `layer` of a texture of `width` × `height`, filtered over `rect` (the pixels its light reached). */
export function denoiseLayer(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  view: DenoiseView,
  iterations: number,
  layer: GPUTextureView,
  size: readonly [number, number],
  rect: readonly [number, number, number, number],
) {
  if (rect[2] <= rect[0] || rect[3] <= rect[1]) return
  if (!denoiseReady(device, 'light')) return
  const pass = encoder.beginComputePass(STEP)
  dispatchPasses(
    device,
    pass,
    { kind: 'light', view: layer, width: size[0], height: size[1], layers: 1 },
    view,
    rect,
    iterations,
  )
  pass.end()
}
