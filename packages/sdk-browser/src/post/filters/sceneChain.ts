import { madeTextureBytes } from '../../gpu/core/textureBytes.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { DOWNSAMPLE_PASS } from '../../diagnostic/stage/passLabels.ts'
import {
  createDownsampleChain,
  downsampleGroup,
  downsampleLevel,
  retireLevel,
  type DownsampleLevel,
} from './downsampleChain.ts'
import { filterPrograms } from './filterPrograms.ts'
import { fullscreenDraw } from './fullscreenDraw.ts'
import { HALF_IMAGE_FORMAT, halfSize } from './levelSizes.ts'

/** The level the log luminance is put in the alpha of: the quarter-size one. */
export const LOG_LUMA_LEVEL = 1

/** The scene's half-size image and its levels (`createSceneChain`). */
export type SceneChain = ReturnType<typeof createSceneChain>

/**
 * THE HALF-SIZE IMAGE OF A FRAME'S INPUT, drawn only for an input no pass wrote it beside — the
 * temporal pass writes it with the image it resolves, the motion blur with the image it leaves
 * (`begin`'s `made`): the lit image the temporal pass is off for, or a device that binds too few
 * storage textures to write it, or any image where the quality asks the chain for it
 * (`temporalDownsampleQuality`, `begin`'s `wide`). Each of its texels one bilinear read at the
 * centre of the four it covers, their mean (`halve`), or, wide, the mean of four such reads, one
 * texel out along each diagonal (`halveWide`). The images the input alternates between each keep
 * their group: a frame makes none.
 */
function createHalfImage(device: GPUDevice) {
  const programs = filterPrograms(device)
  const draw = fullscreenDraw(DOWNSAMPLE_PASS)
  const inputs = createWebgpuBindIdentity(4),
    groups: GPUBindGroup[] = []
  let half: DownsampleLevel | undefined
  return {
    /** The half-size image, none before its first draw. */
    get view() {
      return half?.view
    },
    /** Bytes of the half-size image. */
    get bytes() {
      return half ? madeTextureBytes(half.texture) : 0
    },
    /** Draws the half-size image of `input`, `width × height` texels, made at the first draw, with
     *  the wide filter where `wide`. */
    encode(
      encoder: GPUCommandEncoder,
      input: GPUTextureView,
      width: number,
      height: number,
      wide: boolean,
    ) {
      half ??= downsampleLevel(device, DOWNSAMPLE_PASS, halfSize(width, height), [width, height])
      inputs.next[0] = input
      inputs.next[1] = half.uniform
      if (inputs.moved())
        groups[inputs.slot] = downsampleGroup(device, programs, input, half.uniform)
      const pipeline = programs.pipeline(wide ? 'halveWide' : 'halve', HALF_IMAGE_FORMAT).get()
      draw(encoder, half.view, pipeline, groups[inputs.slot])
    },
    release() {
      if (half) retireLevel(device, half)
      half = undefined
      inputs.clear()
      groups.length = 0
    },
  }
}

/** What `createSceneChain` keeps between calls: the size of the last image, the levels asked for
 *  and drawn, and the frame's encoder, image and half-size image, rewritten in place by `begin`:
 *  a frame allocates none. */
type ChainState = {
  sized: readonly number[]
  asked: number
  drawn: number
  halved: [number, number]
  logLuma?: LogLuma
  /** Whether the chain went on from the log luminance's image this frame. */
  logged: boolean
  encoder?: GPUCommandEncoder
  input?: GPUTextureView
  half?: GPUTextureView
  wide: boolean
}

/** The pass that turns the quarter-size level into the same image with the log luminance of each texel in its alpha (the basic
 *  exposure method's setup): the image, none while the pass is not compiled. */
export type LogLuma = (
  encoder: GPUCommandEncoder,
  quarter: GPUTextureView,
  size: readonly number[],
) => GPUTextureView | undefined

/** Frees the half-size image and the levels. */
function releaseChain(
  state: ChainState,
  half: ReturnType<typeof createHalfImage>,
  chain: ReturnType<typeof createDownsampleChain>,
) {
  half.release()
  chain.dispose()
  state.logLuma = undefined
  state.logged = false
  state.asked = 1
}

/** Draws the levels up to `count − 1` not drawn yet this frame, the half-size image first. */
function drawLevels(
  state: ChainState,
  half: ReturnType<typeof createHalfImage>,
  chain: ReturnType<typeof createDownsampleChain>,
  count: number,
) {
  if (!state.encoder || count <= state.drawn) return
  const { encoder, input } = state as { encoder: GPUCommandEncoder; input: GPUTextureView }
  const [width, height] = state.sized
  state.asked = Math.max(state.asked, count)
  halfSize(width, height, state.halved)
  chain.resize(state.halved[0], state.halved[1], state.asked)
  if (!state.drawn) {
    if (!state.half) half.encode(encoder, input, width, height, state.wide)
    state.drawn = 1
  }
  const first = (state.half ?? half.view)!
  if (state.logLuma && state.drawn <= LOG_LUMA_LEVEL && count > LOG_LUMA_LEVEL) {
    // The chain goes on from the setup's image, as the reference's does (the log luminance in the alpha of its second level).
    chain.encode(encoder, first, LOG_LUMA_LEVEL + 1, state.drawn)
    const logged = state.logLuma(encoder, chain.view(LOG_LUMA_LEVEL)!, chain.size(LOG_LUMA_LEVEL))
    if (logged) {
      chain.stand(LOG_LUMA_LEVEL, logged)
      state.logged = true
    }
    state.drawn = LOG_LUMA_LEVEL + 1
  }
  chain.encode(encoder, first, count, state.drawn)
  state.drawn = count
}

/**
 * THE SCENE AT HALF SIZE AND ITS LEVELS: the image a frame composes, brought down to a quarter of
 * its pixels — by the pass that last wrote it, else `createHalfImage` — and then a chain of ever
 * smaller levels (`createDownsampleChain`).
 * The local exposure reads the half-size image and the fifth level, the bloom the half-size image
 * and, where it needs no setup, all six, the basic exposure method the last (its log luminance in the alpha). `begin` takes the frame's image; `need` draws the levels a
 * reader asks for, each once however many ask, so the readers share every pass.
 */
export function createSceneChain(device: GPUDevice) {
  const chain = createDownsampleChain(device, DOWNSAMPLE_PASS)
  const half = createHalfImage(device)
  const state: ChainState = {
    sized: [0, 0],
    asked: 1,
    drawn: 0,
    halved: [0, 0],
    wide: false,
    logged: false,
  }
  const release = () => releaseChain(state, half, chain)
  return {
    /** The image of level `at`: 0 the half-size image, then each half of the one before. */
    view: (at: number) => (at ? chain.view(at) : (state.half ?? half.view)),
    /** The size of level `at`. */
    size: (at: number) => chain.size(at),
    /** Bytes of the half-size image and the levels made. */
    get bytes() {
      return half.bytes + chain.bytes
    },
    /** Whether the chain went on from the log luminance's image (`begin`'s `logLuma`) this frame. */
    get logged() {
      return state.logged
    },
    /** The size, width then height, of the image the last `begin` took. */
    get imageSize(): readonly number[] {
      return state.sized
    },
    /** Takes the frame's image `input` of `width × height` texels and, where a pass wrote it
     *  beside it, its half-size image `made`, nothing drawn yet — the half-size image the chain
     *  draws is the wide one where `wide` —: the levels of the last frame are forgotten, and a new
     *  size makes them again. */
    begin(
      encoder: GPUCommandEncoder,
      input: GPUTextureView,
      width: number,
      height: number,
      made?: GPUTextureView,
      wide = false,
      logLuma?: LogLuma,
    ) {
      if (state.sized[0] !== width || state.sized[1] !== height) {
        release()
        state.sized = [width, height]
      }
      state.encoder = encoder
      state.input = input
      state.half = made
      state.wide = wide
      state.logLuma = logLuma
      state.logged = false
      chain.unstand()
      state.drawn = 0
    },
    /** Draws the levels up to `count − 1` not drawn yet this frame, the half-size image first:
     *  `count` levels in all, 1 the half-size image alone. */
    need: (count: number) => drawLevels(state, half, chain, count),
    dispose: release,
  }
}
