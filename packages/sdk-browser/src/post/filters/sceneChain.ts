import { madeTextureBytes } from '../../gpu/core/textureBytes.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
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
import { halfSize } from './levelSizes.ts'

/** The scene's half-size image and its levels (`createSceneChain`). */
export type SceneChain = ReturnType<typeof createSceneChain>

/**
 * THE HALF-SIZE IMAGE OF A FRAME'S INPUT: each of its texels one bilinear read at the centre of
 * the four it covers, their mean. The images the input alternates between — the temporal resolve's
 * two histories — each keep their group: a frame makes none.
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
    /** Draws the half-size image of `input`, `width × height` texels, made at the first draw. */
    encode(encoder: GPUCommandEncoder, input: GPUTextureView, width: number, height: number) {
      half ??= downsampleLevel(device, DOWNSAMPLE_PASS, halfSize(width, height), [width, height])
      inputs.next[0] = input
      inputs.next[1] = half.uniform
      if (inputs.moved())
        groups[inputs.slot] = downsampleGroup(device, programs, input, half.uniform)
      draw(encoder, half.view, programs.pipeline('halve', HDR_FORMAT).get(), groups[inputs.slot])
    },
    release() {
      if (half) retireLevel(device, half)
      half = undefined
      inputs.clear()
      groups.length = 0
    },
  }
}

/**
 * THE SCENE AT HALF SIZE AND ITS LEVELS: the image a frame composes, brought down to a quarter of
 * its pixels (`createHalfImage`) and then a chain of ever smaller levels (`createDownsampleChain`).
 * The local exposure reads the half-size image and the fifth level, the bloom the half-size image
 * and, where it needs no setup, all six. `begin` takes the frame's image; `need` draws the levels a
 * reader asks for, each once however many ask, so the readers share every pass.
 */
export function createSceneChain(device: GPUDevice) {
  const chain = createDownsampleChain(device, DOWNSAMPLE_PASS)
  const half = createHalfImage(device)
  let sized: readonly number[] = [0, 0],
    asked = 1,
    drawn = 0
  // The frame's encoder and image, rewritten in place by `begin`: a frame allocates none.
  const frame = {} as { encoder?: GPUCommandEncoder; input?: GPUTextureView }
  const halved: [number, number] = [0, 0]
  const release = () => {
    half.release()
    chain.dispose()
    asked = 1
  }
  return {
    /** The image of level `at`: 0 the half-size image, then each half of the one before. */
    view: (at: number) => (at ? chain.view(at) : half.view),
    /** The size of level `at`. */
    size: (at: number) => chain.size(at),
    /** Bytes of the half-size image and the levels made. */
    get bytes() {
      return half.bytes + chain.bytes
    },
    /** Takes the frame's image `input` of `width × height` texels, nothing drawn yet: the levels
     *  of the last frame are forgotten, and a new size makes them again. */
    begin(encoder: GPUCommandEncoder, input: GPUTextureView, width: number, height: number) {
      if (sized[0] !== width || sized[1] !== height) {
        release()
        sized = [width, height]
      }
      frame.encoder = encoder
      frame.input = input
      drawn = 0
    },
    /** Draws the levels up to `count − 1` not drawn yet this frame, the half-size image first:
     *  `count` levels in all, 1 the half-size image alone. */
    need(count: number) {
      if (!frame.encoder || count <= drawn) return
      const { encoder, input } = frame as { encoder: GPUCommandEncoder; input: GPUTextureView }
      const [width, height] = sized
      asked = Math.max(asked, count)
      halfSize(width, height, halved)
      chain.resize(halved[0], halved[1], asked)
      if (!drawn) {
        half.encode(encoder, input, width, height)
        drawn = 1
      }
      chain.encode(encoder, half.view!, count, drawn)
      drawn = count
    },
    dispose: release,
  }
}
