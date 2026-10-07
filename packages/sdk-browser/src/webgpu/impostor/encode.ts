import { core } from '../../impostor/borrowed.ts'
import { CARD_VIEW_FLOATS } from './cardWgsl.ts'
import { CARD_FLOATS } from '../../impostor/cards.ts'
import { uploaded } from '../../impostor/cardSlots.ts'
import { IMPOSTOR_PASS } from './pipelines.ts'
import type { WebgpuImpostors } from './frame.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

const viewWords = new Float32Array(CARD_VIEW_FLOATS),
  pixelScale = [0, 0]

/** `matrix · translation(eye)` rounded once into `out` at `at`: the matrix at the eye. */
function atEye(out: Float32Array, at: number, matrix: ArrayLike<number>, eye: ArrayLike<number>) {
  for (let k = 0; k < 12; k++) out[at + k] = matrix[k]
  for (let r = 0; r < 4; r++)
    out[at + 12 + r] =
      matrix[12 + r] + matrix[r] * eye[0] + matrix[4 + r] * eye[1] + matrix[8 + r] * eye[2]
}

/** The view the card pass reads: the render view-projection and the camera's own at the eye, the
 *  eye in two singles a component, the focal length's logarithm. */
function cardView(rt: WebgpuPagesRuntime) {
  const cam = rt.run.gate.cam,
    eye = cam.eye
  atEye(viewWords, 0, core.viewProj, eye)
  atEye(viewWords, 16, cam.viewProjection, eye)
  for (let k = 0; k < 3; k++) {
    const high = Math.fround(eye[k])
    viewWords[32 + k] = high
    viewWords[36 + k] = eye[k] - high
  }
  core.pixelScaleOf(cam.projection, rt.setup.viewport ?? rt.gpu.targetSize, pixelScale)
  viewWords[35] = Math.log2(Math.max(pixelScale[0], pixelScale[1]))
  viewWords[39] = 0
  return viewWords
}

/** The records written since the last image, each run of consecutive slots in one write; all of
 *  them into a buffer just made. */
function uploadRecords(device: GPUDevice, state: WebgpuImpostors, buffer: GPUBuffer) {
  const slots = state.slots,
    records = slots.records
  if (slots.full || state.uploadedTo !== buffer) {
    device.queue.writeBuffer(buffer, 0, records, 0, slots.used * CARD_FLOATS)
    state.uploadedTo = buffer
    return uploaded(slots)
  }
  const dirty = slots.dirty.subarray(0, slots.dirtyCount).sort()
  for (let i = 0; i < dirty.length;) {
    let end = i + 1
    while (end < dirty.length && dirty[end] === dirty[end - 1] + 1) end++
    device.queue.writeBuffer(
      buffer,
      dirty[i] * CARD_FLOATS * 4,
      records,
      dirty[i] * CARD_FLOATS,
      (end - i) * CARD_FLOATS,
    )
    i = end
  }
  uploaded(slots)
}

/** The image's cards (`frame.ts`), when it has any. */
const cardsOf = (rt: WebgpuPagesRuntime) => {
  const state = rt.gpu.impostors
  return state?.count ? state : undefined
}

/** One instanced draw per mesh atlas, with `pipeline`, on `pass`. */
function drawRuns(
  rt: WebgpuPagesRuntime,
  state: WebgpuImpostors,
  pass: GPURenderPassEncoder,
  pipeline: GPURenderPipeline,
  image = state.pass.imageGroup(state.slots.used),
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, image.group)
  for (let r = 0; r < state.runCount; r++) {
    const run = state.runs[r]
    pass.setBindGroup(1, run.group)
    pass.draw(6, run.count, 0, run.first)
  }
  rt.run.gpuDrawCalls += state.runCount
}

/**
 * The cards' visibility stage, drawn into the open primary visibility pass `pass` before the Hi-Z
 * pyramid is built: identifier 0, the depth where the mesh's surface would be, and the pyramid's
 * level 0 when `hiz`. It first sends the image's view — its render view-projection, jitter
 * included, and the camera's own, both at the eye, and the eye — and the card records written since
 * the last image, which the surface stage reads too. True when it drew.
 */
export function drawImpostorVisibility(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPURenderPassEncoder,
  hiz: boolean,
) {
  const state = cardsOf(rt)
  if (!state) return false
  const image = state.pass.imageGroup(state.slots.used)
  device.queue.writeBuffer(state.pass.viewBuffer, 0, cardView(rt))
  uploadRecords(device, state, image.buffer)
  drawRuns(rt, state, pass, state.pass.visPipeline(hiz), image)
  return true
}

/**
 * The visibility stage of an image with no drawable row, whose every root may stand behind its
 * card: one pass clearing the identifiers and the depth, then the cards. True when it drew — the
 * depth then holds them, and the surfaces' pass keeps it.
 */
export function encodeImpostorVisibilityPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { visView } = rt.vis,
    { depthView } = rt.gpu
  if (!cardsOf(rt) || !visView || !depthView) return false
  const pass = encoder.beginRenderPass({
    label: `${IMPOSTOR_PASS} visibility`,
    colorAttachments: [
      { view: visView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
    ],
    depthStencilAttachment: {
      view: depthView,
      depthClearValue: core.DEPTH_CLEAR,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  })
  const [width, height] = rt.gpu.targetSize
  pass.setViewport(0, 0, width, height, 0, 1)
  drawImpostorVisibility(rt, device, pass, false)
  pass.end()
  return true
}

/**
 * The cards' surface stage, over the opaque surfaces the material passes wrote and before they are
 * lit: each card writes its surface where its depth is the one the visibility stage kept. An image
 * without cards encodes nothing.
 */
export function encodeImpostorCards(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const state = cardsOf(rt),
    { surfaces, depthView } = rt.gpu
  if (!state || !surfaces || !depthView) return
  const draw = encoder.beginRenderPass({
    label: IMPOSTOR_PASS,
    colorAttachments: core.surfaceLoadAttachments(surfaces),
    depthStencilAttachment: { view: depthView, depthReadOnly: true },
  })
  const [width, height] = rt.gpu.targetSize
  draw.setViewport(0, 0, width, height, 0, 1)
  drawRuns(rt, state, draw, state.pass.pipeline)
  draw.end()
}
