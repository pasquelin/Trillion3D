import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { askedComputeStage, dispatchOn } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { viewOf } from '../../../materials/surface/surfaceOutputs.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import {
  INDIRECT_WORDS_BINDINGS,
  INDIRECT_WORDS_FLAG,
  INDIRECT_WORDS_FORMAT,
  indirectWordsEntries,
  indirectWordsProgram,
} from './indirectWordsWgsl.ts'
import { tellLighting } from './frame.ts'
import { screenProbeSettingsOf } from './settingsOf.ts'

const NORMALS_VIEW = viewOf('normalRough')

/** The mode these words tell the lighting (`screenProbes.w`): their light, not the sky light's over their occlusion (bit 0 clear); no back of a thin sheet gathered (bit 1); no occlusion for the lighting to apply (bit 2) —
 *  the openness is in the bent normal, which the specular occlusion reads — or, where the words hold an occlusion the lighting applies (`appliesOcclusion`), the same without bit 2. */
const WORDS_MODE_OCCLUDING = 2
const WORDS_MODE = WORDS_MODE_OCCLUDING + 4

/** What gathered the pixels' indirect light, as the writer reads it: textures of the mean radiance by texel (`light`, its alpha saying the texel answered where `alphaAnswers`), of the rough specular's radiance
 *  and of the openness (read where `openTexture`), a texel every `reduction` pixels (the texel t at the pixel t times the reduction), and the factor the radiance is written under (the image's pre-exposure, where the source
 *  holds it apart). */
export interface IndirectSource {
  light: GPUTextureView
  rough: GPUTextureView
  open: GPUTextureView
  reduction: number
  alphaAnswers: boolean
  openTexture: boolean
  /** The pixels a texel of the openness stands for along an axis where that is not the light's `reduction`, zero where it is. */
  openReduction: number
  /** Whether the openness texture holds the bent normal's word (`spBentPack`) of the pixel's own texel, else an amount. */
  openBent: boolean
  exposure: number
  /** Whether the lighting applies the occlusion the words hold (the field's short-range occlusion), else it finds it applied already (the screen's own light). */
  appliesOcclusion: boolean
}

/** The writer's kernels for a device, with an amount or with the bent normal's word as the openness: asked off the frame, none until compiled. */
const writerKernels = oncePerDevice((device: GPUDevice) => {
  const make = (bent: boolean) => {
    const label = `Trillion3D indirect words${bent ? ' bent' : ''}`
    const layout = device.createBindGroupLayout({ label, entries: indirectWordsEntries(bent) })
    return {
      layout,
      stage: askedComputeStage(
        device,
        [layout],
        indirectWordsProgram(bent),
        'indirectWords',
        label,
        () => undefined,
      ),
    }
  }
  return { amount: make(false), bent: make(true) }
})

/** The words of a view, at the size of its image, and the image they were last written in. */
interface Held {
  texture: GPUTexture
  view: GPUTextureView
  params: GPUBuffer
  size: readonly [number, number]
  frame: number
  group: GPUBindGroup | undefined
  identity: ReturnType<typeof createWebgpuBindIdentity>
}
const held = new WeakMap<WebgpuPagesRuntime['gpu'], Held>()
const paramWords = new Uint32Array(4)
const paramFloats = new Float32Array(paramWords.buffer)

function heldOf(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const [width, height] = rt.gpu.targetSize
  let state = held.get(rt.gpu)
  if (state && state.size[0] === width && state.size[1] === height) return state
  if (state) retire(device, state.texture)
  const texture = device.createTexture({
    label: 'Trillion3D indirect words',
    size: [width, height],
    format: INDIRECT_WORDS_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  state = {
    texture,
    view: texture.createView(),
    params: device.createBuffer({
      label: 'Trillion3D indirect words parameters',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    size: [width, height],
    frame: -1,
    group: undefined,
    identity: createWebgpuBindIdentity(),
  }
  held.set(rt.gpu, state)
  return state
}

/**
 * THE ONE WRITE OF THE WORDS THE LIGHTING READS OF THE PIXELS' INDIRECT LIGHT, for a source other than the screen probes (`indirectSourceOf`): the irradiance field's gather, the screen's own
 * indirect light. It encodes the writer (`indirectWordsProgram`) over the image, so that this image's lighting reads `indirectWordsView`. Nothing while the writer compiles or the frame lacks the
 * surfaces: the lighting then takes the sky light's irradiance. Answers whether it wrote.
 */
export function writeIndirectWords(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  source: IndirectSource,
) {
  const surfaces = rt.gpu.surfaces
  const kernels = writerKernels(device)
  const kernel = source.openBent ? kernels.bent : kernels.amount
  if (!surfaces || !kernel.stage.get()) return false
  const state = heldOf(rt, device)
  paramWords[0] = source.reduction
  paramWords[1] =
    (source.alphaAnswers ? INDIRECT_WORDS_FLAG.alphaAnswers : 0) |
    (source.openTexture ? INDIRECT_WORDS_FLAG.openTexture : 0)
  paramFloats[2] = source.exposure
  paramWords[3] = source.openReduction
  device.queue.writeBuffer(state.params, 0, paramWords)
  const normals = surfaces.views()[NORMALS_VIEW]
  const { next } = state.identity
  next[0] = normals
  next[1] = source.light
  next[2] = source.rough
  next[3] = source.open
  if (!state.group || state.identity.moved()) {
    const B = INDIRECT_WORDS_BINDINGS
    state.group = device.createBindGroup({
      layout: kernel.layout,
      entries: [
        { binding: B.normals, resource: normals },
        { binding: B.light, resource: source.light },
        { binding: B.rough, resource: source.rough },
        { binding: B.open, resource: source.open },
        { binding: B.params, resource: { buffer: state.params } },
        { binding: B.words, resource: state.view },
      ],
    })
  }
  const pass = encoder.beginComputePass({ label: 'Trillion3D indirect words' })
  dispatchOn(pass, kernel.stage, state.group, ceilDiv(state.size[0], 8), ceilDiv(state.size[1], 8))
  pass.end()
  state.frame = rt.run.frame
  if (rt.gpu.deferred)
    tellLighting(
      rt.gpu.deferred,
      screenProbeSettingsOf(rt),
      source.appliesOcclusion ? WORDS_MODE_OCCLUDING : WORDS_MODE,
    )
  return true
}

/** The words this image's writer wrote, none where it wrote none this image. */
export function indirectWordsView(rt: WebgpuPagesRuntime) {
  const state = held.get(rt.gpu)
  return state && state.frame === rt.run.frame ? state.view : undefined
}

/** The view's words given back. */
export function releaseIndirectWords(gpu: WebgpuPagesRuntime['gpu']) {
  held.get(gpu)?.texture.destroy()
  held.delete(gpu)
}
