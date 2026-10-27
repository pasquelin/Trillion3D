import { storedTargetUsage } from './resolve.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { keptTexture } from './keptTexture.ts'
import { slotsOf } from './historyFrames.ts'
import {
  halfImageBytes,
  historyBytesPerPixel,
  isUpscaled,
  type HistoryShape,
} from './historyShape.ts'
import { analysisBytes } from './analysisTargets.ts'
import { outputBytes } from './historyResolve.ts'
import { halfSize } from '../filters/levelSizes.ts'

/** One frame of the history: its colour, and its validity (`HistoryFormats.validity`). */
export interface HistoryFrame {
  color: GPUTextureView
  validity: GPUTextureView
}

/** The temporal pass's target bytes for a frame of `size` with the history `shape`: the history's
 *  frames at its size, the half-size image beside the display's colour, the resolve's output where
 *  the history is larger than the display, the analysis's targets and render-resolution histories at
 *  its render size — the render targets' own, the largest a frame is drawn at, so no scale under it
 *  remakes them (`analysis.ts`) — and the guide of each
 *  frame beyond the first. */
export const taaTargetBytes = (
  size: { width: number; height: number; renderWidth: number; renderHeight: number },
  shape: HistoryShape,
) =>
  shape.width * shape.height * historyBytesPerPixel(shape) +
  halfImageBytes(shape.displayWidth, shape.displayHeight, shape.formats.color) +
  (isUpscaled(shape) ? outputBytes(size.width, size.height, shape.formats.color) : 0) +
  analysisBytes(size.renderWidth, size.renderHeight, shape, 0)

/** The frames of a history of `shape` and the half-size image of the display's, their textures kept
 *  in `textures`. */
function makeHistoryFrames(device: GPUDevice, textures: GPUTexture[], shape: HistoryShape) {
  const usage = storedTargetUsage()
  const target = (label: string, format: GPUTextureFormat, width: number, height: number) => {
    return keptTexture(device, textures, {
      label,
      size: { width, height },
      format,
      usage,
    }).createView()
  }
  const frames: HistoryFrame[] = []
  for (let i = 0; i < slotsOf(shape.sequence); i++)
    frames.push({
      color: target(`Trillion3D TAA history ${i}`, shape.formats.color, shape.width, shape.height),
      validity: target(
        `Trillion3D TAA validity ${i}`,
        shape.formats.validity,
        shape.width,
        shape.height,
      ),
    })
  const [halfWidth, halfHeight] = halfSize(shape.displayWidth, shape.displayHeight)
  const half = target('Trillion3D TAA output half', shape.formats.color, halfWidth, halfHeight)
  return { frames, half }
}

/** The temporal pass's history frames (`historyFrames.ts`) at the history's size, each a colour and
 *  its validity, and the half-size image of the display's the update or the resolve writes beside
 *  the colour: none until `allocate`. */
export function createTaaHistoryTargets(device: GPUDevice) {
  const textures: GPUTexture[] = []
  const targets = {
    /** What the frames were made as, none before `allocate`. */
    shape: undefined as HistoryShape | undefined,
    /** The frames, by slot. */
    frames: [] as HistoryFrame[],
    /** The half-size image of the display's, written by the pass beside its colour: the scene's chain
     *  reads it; none before `allocate`. */
    half: undefined as GPUTextureView | undefined,
    /** The history's size, 0 × 0 before `allocate`. */
    get width() {
      return targets.shape?.width ?? 0
    },
    get height() {
      return targets.shape?.height ?? 0
    },
    /** Bytes of the targets as allocated. */
    get bytes() {
      const { shape } = targets
      return shape && textures.length
        ? shape.width * shape.height * historyBytesPerPixel(shape) +
            halfImageBytes(shape.displayWidth, shape.displayHeight, shape.formats.color)
        : 0
    },
    drop() {
      // This image's commands may still name them: retired, destroyed after the frame's submit.
      for (const texture of textures) retire(device, texture)
      textures.length = 0
      targets.frames.length = 0
      targets.half = undefined
      targets.shape = undefined
    },
    /** Makes the frames of `shape`, the former ones dropped (`drop`). */
    allocate(shape: HistoryShape) {
      targets.drop()
      targets.shape = shape
      const { frames, half } = makeHistoryFrames(device, textures, shape)
      targets.frames.push(...frames)
      targets.half = half
    },
  }
  return targets
}
