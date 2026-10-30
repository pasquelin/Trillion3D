import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesCore, WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { ownedReadbacks } from '../../gpu/core/ownedReadback.ts'
import { createTextOverlay, TEXT_LINE } from '../../diagnostic/textOverlay.ts'
import { DEBUG_COLORS } from '../../hair/debugLines.ts'
import {
  OIT_PASS_REGULAR,
  OIT_PASS_SEPARATE,
  oitSampleCount,
  readOrderIndependentTranslucencySetting as read,
} from '../../../../sdk-core/src/contracts/orderIndependentTranslucencyOptions.ts'
import { layersSize } from '../reducedView.ts'
import { oitSceneDepth } from './oitCodec.ts'
import { unpackLightWord } from '../../gpu/core/smallFloat.ts'
import { OIT_DEBUG_WORDS, OIT_NO_CURSOR, oitDebugOffset } from './oitLayout.ts'
import type { OitBuffers } from './oitResources.ts'

/** The figures start at the pixel (50, 80), the cursor's own at the cursor. */
const GLOBAL_LEFT = 50
const GLOBAL_TOP = 80
const PIXEL_OFFSET = 14
const READBACKS = 2

/** The samples of one pixel as the GPU holds them. */
interface OitPixelFigures {
  readonly count: number
  readonly samples: readonly {
    readonly depth: number
    readonly colour: readonly number[]
    readonly trans: readonly number[]
  }[]
}

/** The bytes copied for a pixel: the figures the combination wrote (`oitLayout.ts`). */
export const OIT_PIXEL_BYTES = OIT_DEBUG_WORDS * 4

/** Reads the words copied for a pixel keeping `samples` fragments at most (`OIT_PIXEL_BYTES`): the fragments kept, the count that reached the pixel (shown as the reference stores it, held to `samples`), then each kept fragment's three words. */
export function readOitPixel(words: Uint32Array, samples: number): OitPixelFigures {
  const count = Math.min(words[1]!, samples)
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length)
  const held = Math.min(words[0]!, samples)
  return {
    count,
    samples: Array.from({ length: held }, (_, k) => {
      const at = 2 + k * 3
      return {
        // The depth is stored negated, so that the smaller is the nearer.
        depth: -floats[at]!,
        colour: unpackLightWord(words[at + 1]!),
        trans: unpackLightWord(words[at + 2]!),
      }
    }),
  }
}

const f = (v: number) => v.toFixed(4)
const triple = (v: readonly number[]) => v.map(f).join(' ')

/** The lines of the figures: the global ones (method, samples, pass), then the pixel's; `depthOf` turns a sample's normalized depth into the scene depth shown. */
export function oitDebugLines(
  method: number,
  samples: number,
  passes: number,
  pass: number,
  pixel: readonly [number, number],
  figures: OitPixelFigures | undefined,
  depthOf: (z: number) => number = (z) => z,
) {
  const global = [
    `Method          : ${method === 0 ? 'K-Buffer' : 'MLAB'}`,
    `Max Sample Count: ${samples}`,
    `Current Pass    : ${pass & OIT_PASS_REGULAR ? 'Regular Translucency' : 'Separate Translucency'}`,
    `Transp. Regular : ${passes & OIT_PASS_REGULAR ? 'On' : 'Off'}`,
    `Transp. Separate: ${passes & OIT_PASS_SEPARATE ? 'On' : 'Off'}`,
  ]
  const own = figures
    ? [
        `Pixel Coord.: ${pixel[0]} ${pixel[1]}`,
        `Sample Count: ${figures.count} ${samples}`,
        `Method: ${method === 0 ? 'K-Buffer' : 'MLAB'}`,
        ...figures.samples.flatMap((s) => [
          `Depth ${f(depthOf(s.depth))}`,
          `Color ${triple(s.colour)}`,
          `Trans. ${triple(s.trans)}`,
        ]),
      ]
    : []
  return { global, own }
}

interface OitDebugState {
  readonly overlay: ReturnType<typeof createTextOverlay>
  figures?: OitPixelFigures
  samples: number
  /** Whether this image's sorted pass copied the figures (a draw of the image that encoded layers): the figures are written over the image only then. */
  taken: boolean
}
const readbacks = ownedReadbacks<OitDebugState>(
  { label: 'oit.pixel', bytes: OIT_PIXEL_BYTES, count: READBACKS },
  (device) => ({ overlay: createTextOverlay(device), samples: 0, taken: false }),
  (state, mapped, samples) => {
    state.figures = readOitPixel(new Uint32Array(mapped), samples)
  },
)

/** The pixel whose figures are written, none where the cursor is out of the view (the cursor must lie inside it, off its first row and column and its last). */
function cursorOf(rt: WebgpuPagesRuntime): [number, number] | undefined {
  const [width, height] = rt.gpu.targetSize
  const x = read(rt, 'oitDebugCursorX'),
    y = read(rt, 'oitDebugCursorY')
  return x > 0 && y > 0 && x < width - 1 && y < height - 1 ? [x, y] : undefined
}

/** Whether the debug figures are asked for the separate translucency, which every layer of the engine is drawn in. */
const debugging = (rt: WebgpuPagesRuntime) => read(rt, 'oitDebug') === OIT_PASS_SEPARATE

/** The word of the pixel whose figures the combination writes (the pixel index in the size the layers are drawn at, the cursor's place scaled to it
 *  where the layers are smaller than the image), `OIT_NO_CURSOR` where the debug is off or the cursor is out of the view. */
export function oitCursorWord(rt: WebgpuPagesRuntime) {
  const pixel = debugging(rt) ? cursorOf(rt) : undefined
  if (!pixel) return OIT_NO_CURSOR
  const { gpu } = rt,
    [width, height] = layersSize(gpu)
  const x = Math.min(width - 1, Math.trunc((pixel[0] * width) / gpu.targetSize[0])),
    y = Math.min(height - 1, Math.trunc((pixel[1] * height) / gpu.targetSize[1]))
  return y * width + x
}

/**
 * After a draw composed its fragments: the copy of the figures of the cursor's pixel to a staging buffer, read a few images late. Taken once an
 * image, by the first draw that sorted layers: the reference writes the figures of the one pass that matches the pass asked.
 */
export function copyOitPixel(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  { pool, pixels, nodes, samples, low }: OitBuffers,
  cursor: number,
) {
  if (!debugging(rt)) return disposeOitDebug(rt)
  if (cursor === OIT_NO_CURSOR) return
  const state = readbacks.of(device, rt)
  if (state.taken) return
  const staging = state.ring.take(samples, OIT_PIXEL_BYTES)
  if (!staging) return
  encoder.copyBufferToBuffer(
    pool,
    oitDebugOffset(pixels, samples, low, nodes),
    staging,
    0,
    OIT_PIXEL_BYTES,
  )
  state.samples = samples
  state.taken = true
}

/** The figures, written over the display image where the render-size pixel of the cursor lies, when this image sorted layers. */
export function encodeOitDebug(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu } = rt
  const state = readbacks.peek(rt)
  if (!debugging(rt)) return disposeOitDebug(rt)
  const pixel = cursorOf(rt)
  // The reference writes nothing, the global figures included, where the cursor is out of the view or the pass did not run: the state is kept for the next image.
  if (!gpu.displayView || !pixel || !state?.taken) return
  state.taken = false
  const [width, height] = gpu.targetSize
  const left = Math.round((pixel[0] * gpu.displaySize[0]) / width),
    top = Math.round((pixel[1] * gpu.displaySize[1]) / height)
  const { global, own } = oitDebugLines(
    read(rt, 'oitMethod'),
    oitSampleCount(read(rt, 'oitMaxSampleCount')),
    read(rt, 'oitPassType'),
    OIT_PASS_SEPARATE,
    pixel,
    state.figures,
    (z) => oitSceneDepth(cam.projection, z),
  )
  state.overlay.begin(cam)
  global.forEach((line, at) =>
    state.overlay.lines.text(line, GLOBAL_LEFT, GLOBAL_TOP + at * TEXT_LINE, DEBUG_COLORS.yellow),
  )
  own.forEach((line, at) =>
    state.overlay.lines.text(line, left + PIXEL_OFFSET, top + at * TEXT_LINE, DEBUG_COLORS.white),
  )
  state.overlay.encode(encoder, gpu.displayView, gpu.displaySize, cam)
}

/** After the frame's submit: the copy of the figures of the pixel maps. */
export function oitDebugSubmitted(rt: WebgpuPagesCore) {
  readbacks.submitted(rt)
}

/** Gives the figures' text and readback back. */
export function disposeOitDebug(rt: WebgpuPagesCore) {
  readbacks.dispose(rt)?.overlay.dispose()
}
