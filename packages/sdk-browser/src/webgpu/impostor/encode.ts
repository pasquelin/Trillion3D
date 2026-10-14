import { core } from '../../impostor/borrowed.ts'
import { CARD_VIEW_FLOATS } from './cardWgsl.ts'
import { uploadRecords } from './cardUpload.ts'
import { matrixAtRenderOrigin } from '../../../../math/src/projection/renderOrigin.ts'
import { writeSplitDouble } from '../../../../math/src/float/splitDouble.ts'
import { IMPOSTOR_PASS, IMPOSTOR_VISIBILITY_PASS } from '../../stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { WebgpuImpostors } from './frame.ts'

const viewWords = new Float32Array(CARD_VIEW_FLOATS),
  viewBits = new Uint32Array(viewWords.buffer)

/** The view the card pass reads: the render view-projection and the camera's own at the eye
 *  (`matrixAtRenderOrigin`), the eye in two singles a component, the focal length's logarithm, the
 *  feedback's phase word (`phaseWord`). */
function cardView(rt: WebgpuPagesRuntime) {
  const cam = rt.run.gate.cam,
    eye = cam.eye
  matrixAtRenderOrigin(viewWords, core.viewProj, eye, 0)
  matrixAtRenderOrigin(viewWords, cam.viewProjection, eye, 16)
  for (let k = 0; k < 3; k++) writeSplitDouble(viewWords, 32 + k, 36 + k, eye[k])
  const viewport = rt.setup.viewport ?? rt.gpu.targetSize
  viewWords[35] = Math.log2(core.focalPixels(cam.projection, viewport?.[0], viewport?.[1]))
  viewBits[39] = rt.vis.textures?.feedback.phaseWord(rt.run.textureConverging) ?? 0
  return viewWords
}

/** The group of the tile pool the image's cards (`frame.ts`) read their maps from, when it has
 *  any: cached by the pass, nothing made for a group that stays. */
const cardTiles = (rt: WebgpuPagesRuntime) => {
  const state = rt.gpu.impostors,
    textures = rt.vis.textures,
    sampler = rt.vis.mapsSampler
  return state?.count && textures && sampler ? state.pass.tilesGroup(textures, sampler) : undefined
}

/** One instanced draw per mesh, with `pipeline`, on `pass`: every card reads the one tile group. */
function drawRuns(
  rt: WebgpuPagesRuntime,
  state: WebgpuImpostors,
  tiles: GPUBindGroup,
  pass: GPURenderPassEncoder,
  pipeline: GPURenderPipeline,
  image = state.pass.imageGroup(state.slots.used),
  ids?: GPUBindGroup,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, image.group)
  pass.setBindGroup(1, tiles)
  if (ids) pass.setBindGroup(2, ids)
  for (let r = 0; r < state.runCount; r++) {
    const run = state.runs[r]
    pass.draw(4, run.count, 0, run.first)
  }
  rt.run.gpuDrawCalls += state.runCount
}

/**
 * The cards' visibility stage, drawn into the open primary visibility pass `pass` before the Hi-Z
 * pyramid is built: the card's identifier (`VIS_CARD_BASE | slot`), the depth where the mesh's surface would be, and the pyramid's
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
  const tiles = cardTiles(rt)
  if (!tiles) return false
  // `cardTiles` makes a group only for an image that has cards.
  const state = rt.gpu.impostors!,
    image = state.pass.imageGroup(state.slots.used)
  device.queue.writeBuffer(state.pass.viewBuffer, 0, cardView(rt))
  uploadRecords(device, state, image.buffer)
  drawRuns(rt, state, tiles, pass, state.pass.visPipeline(hiz), image)
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
  if (!cardTiles(rt) || !visView || !depthView) return false
  const pass = encoder.beginRenderPass({
    label: IMPOSTOR_VISIBILITY_PASS,
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
 * lit: each card writes its surface where the identifier the visibility stage kept is its own, and,
 * while the frame's pipelines write the feedback, the tile its pixel reads — the target loaded,
 * the opaque resolve's requests kept beside (`cardColorAttachments`). An image without cards
 * encodes nothing.
 */
export function encodeImpostorCards(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const tiles = cardTiles(rt),
    { surfaces } = rt.gpu,
    { visView } = rt.vis
  if (!tiles || !surfaces || !visView) return
  const state = rt.gpu.impostors!,
    { pass } = state
  const draw = encoder.beginRenderPass({
    label: IMPOSTOR_PASS,
    colorAttachments: core.cardColorAttachments(rt, surfaces),
  })
  const [width, height] = rt.gpu.targetSize
  draw.setViewport(0, 0, width, height, 0, 1)
  const pipeline = pass.surfacePipeline(rt.vis.writesFeedback)
  drawRuns(rt, state, tiles, draw, pipeline, undefined, pass.idsGroup(visView))
  draw.end()
}
