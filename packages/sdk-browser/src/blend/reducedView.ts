import { VIEW } from './viewLayout.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { depthOwner, layersApart, type TranslucencyTargets } from './translucency.ts'
import { drawnSide, runtimeTranslucencyFraction } from './translucencyScale.ts'
import { writeChanged } from '../gpu/core/writeChanged.ts'
import { wordsOf } from '../gpu/core/wordViews.ts'
import { downsampleTranslucencyDepth } from './translucencyDepth.ts'

/**
 * THE SMALLER LAYERS' PASSES (`translucencyScale.ts`) draw with the same programs as the others, whose view uniform holds the size they draw
 * at over the image's (`VIEW.reduced`, 1 in every pass but these). The uniform is written once an image; `reducedBuffer` holds its two words
 * set to 1 and then to the ratio of this image (written whole by `beginTranslucencyScale` before a pass reads it), which `selectReduced` copies into the uniform between passes, so the passes of the layers
 * and those of the scene's size share one buffer. (A write of the queue is ordered with the submission, not within the encoder: the switch
 * between the two sizes is a copy the encoder makes.)
 */
export const REDUCED_WORDS_BYTES = 16
const words = new Float32Array(4)
words[0] = words[1] = 1

/** Sets the size the passes that follow draw at in the view uniform: the smaller layers' ratio (`reduced`) or the image's own. The caller
 *  asks it where the layers are drawn smaller (`LayersTarget.apart`). */
export function selectReduced(
  encoder: GPUCommandEncoder,
  rt: Pick<WebgpuPagesRuntime, 'blendState'>,
  reduced: boolean,
) {
  const { viewBuffer, reducedBuffer } = rt.blendState
  if (!viewBuffer || !reducedBuffer) return
  encoder.copyBufferToBuffer(reducedBuffer, reduced ? 8 : 0, viewBuffer, VIEW.reduced * 4, 8)
}

/**
 * Begins the smaller layers of an image: the size each set is drawn at (the translucency fraction of the frame's drawn size, held to the
 * targets), the depth they are tested against not yet made (`layersReady` makes it when a pass draws), and the ratio words `selectReduced`
 * copies. Nothing where the targets are not smaller.
 */
export function beginTranslucencyScale(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { gpu, blendState } = rt,
    main = gpu.translucency
  if (!main?.reduced) return
  const fraction = runtimeTranslucencyFraction(rt, gpu.targetSize, gpu.displaySize)
  fitLayers(main, gpu.targetSize, fraction)
  if (main.late) fitLayers(main.late, gpu.targetSize, fraction)
  main.reduced.depthReady = false
  if (blendState.reducedBuffer) {
    words[2] = main.drawn[0] / gpu.targetSize[0]
    words[3] = main.drawn[1] / gpu.targetSize[1]
    writeChanged(device, blendState.reducedBuffer, wordsOf(words), 0, 4)
  }
}

/** Sets the size `set` is drawn at for an image drawn at `target`, and whether it is drawn apart: at a size other than the image's, the only
 *  case that runs the passes of the smaller layers (the reference scales its translucency only when the sizes differ). */
export function fitLayers(
  set: TranslucencyTargets,
  target: readonly [number, number],
  fraction: number,
) {
  set.drawn[0] = drawnSide(target[0], fraction, set.extent[0])
  set.drawn[1] = drawnSide(target[1], fraction, set.extent[1])
  set.reduced!.apart = set.drawn[0] !== target[0] || set.drawn[1] !== target[1]
}

/** Where the layers of an image are drawn: the target a pass of them reads of the set (`layersTarget`), resolved once for the passes of an
 *  image's draw, which are handed it instead of each testing the set. */
export interface LayersTarget {
  /** Whether the layers are drawn smaller than the image this image. */
  apart: boolean
  /** The size of what they are drawn into and the depth they are tested against: the image's, or the smaller set's. */
  size: readonly [number, number]
  depth: GPUTextureView
  /** The smaller layers' own texture feedback, none where they are drawn at the image's size. */
  feedback: GPUTextureView | undefined
}
const target: LayersTarget = {
  apart: false,
  size: [0, 0],
  depth: undefined as unknown as GPUTextureView,
  feedback: undefined,
}

/** The target the layers of `gpu.translucency` are drawn into, written in place: read it before the next call. */
export function layersTarget(gpu: {
  targetSize: readonly [number, number]
  depthView?: GPUTextureView
  translucency?: Pick<TranslucencyTargets, 'reduced' | 'drawn'>
}): LayersTarget {
  const set = gpu.translucency
  target.apart = layersApart(set)
  target.size = target.apart ? set!.drawn : gpu.targetSize
  target.depth = target.apart ? set!.reduced!.depthView : gpu.depthView!
  target.feedback = target.apart ? set!.reduced!.feedbackView : undefined
  return target
}

/** The size the layers of `gpu.translucency` are drawn at: the image's, or the reduced size. */
export const layersSize = (gpu: Parameters<typeof layersTarget>[0]) => layersTarget(gpu).size

/** The depth the layers of `gpu.translucency` are tested against: the scene's, or its smaller copy. */
export const layersDepth = (gpu: Parameters<typeof layersTarget>[0]) => layersTarget(gpu).depth

/** Whether the layers of `gpu.translucency` can be drawn this image: always, but while the reduced ones wait for their depth, which this
 *  makes at the first pass that draws (`downsampleTranslucencyDepth`) — an image none of them draws makes none. */
export function layersReady(
  gpu: Pick<WebgpuPagesRuntime['gpu'], 'translucency' | 'depthView' | 'targetSize'>,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const set = gpu.translucency
  if (!layersApart(set)) return true
  const owner = depthOwner(set!.reduced!)
  if (!owner.depthReady)
    owner.depthReady = downsampleTranslucencyDepth(
      device,
      encoder,
      set!,
      gpu.depthView!,
      gpu.targetSize,
    )
  return owner.depthReady
}
