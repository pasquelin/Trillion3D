import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { feedbackAttachment } from '../../frame/prepare/attachments.ts'
import { skyLightReadOf } from '../../frame/render/skyLightState.ts'
import { bindForwardReflection } from '../../lighting/reflections/group.ts'
import {
  WATER_COPY_PASS,
  WATER_DEPTH_PASS,
  WATER_MASK_PASS,
  WATER_PASS,
  WATER_COMPOSITE_PASS,
  WATER_TILES_PASS,
  WATER_VELOCITY_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { drawBlendRuns, sharedBlendGroup } from '../draw.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { WATER_GROUP, WATER_TILE_PIXELS } from './waterLayout.ts'
import type { WaterFrame } from './waterFrame.ts'
import { waterCompositeGroup, waterIdsGroup } from './waterTargets.ts'

const WATER_VELOCITY_PASS_DESCRIPTOR: GPUComputePassDescriptor = { label: WATER_VELOCITY_PASS }
const WATER_TILES_PASS_DESCRIPTOR: GPUComputePassDescriptor = { label: WATER_TILES_PASS }

const CLEARED: GPUColor = { r: 0, g: 0, b: 0, a: 0 }
const colour = (view: GPUTextureView, clear = true): GPURenderPassColorAttachment => ({
  view,
  loadOp: clear ? 'clear' : 'load',
  clearValue: CLEARED,
  storeOp: 'store',
})

const velocityRun = new ComputeRun()

/** Copies the scene's depth into the water's depth texture. */
const copySceneDepth = (f: WaterFrame) =>
  f.encoder.copyTextureToTexture(
    { texture: f.depthTexture },
    { texture: f.targets.waterDepth },
    f.extent,
  )

/** The water's velocity (`singleLayerWaterVelocityOutputPass`): the vectors of the texels it covers, and their
 *  identifiers cleared so that the temporal pass reads them as a surface that moves with the camera alone.
 *  Returns the passes encoded. */
function encodeVelocity(f: WaterFrame) {
  const { rt, encoder, targets } = f
  const velocity = rt.gpu.velocity?.measured ? rt.gpu.velocity : undefined
  const ids = f.stages.ids.get()
  if (!velocity || !rt.vis.visView || !ids) return 0
  // The vectors and the identifiers follow one another: one compute pass, but on a frame timed per pass.
  const steps = velocityRun.begin(encoder)
  velocity.encodeWater(steps, targets.views.waterDepth)
  const pass = steps.pass(WATER_VELOCITY_PASS_DESCRIPTOR)
  pass.setPipeline(ids)
  pass.setBindGroup(0, waterIdsGroup(f.device, targets, f.depthView, rt.vis.visView))
  pass.dispatchWorkgroups(ceilDiv(f.width, WATER_TILE_PIXELS), ceilDiv(f.height, WATER_TILE_PIXELS))
  steps.end()
  return 1
}

/** The velocity pass of the depth pass, when `singleLayerWaterVelocityOutputPass` asks for it there. */
const velocityInPrepass = (f: WaterFrame) =>
  f.prepass && f.settings.singleLayerWaterVelocityOutputPass === 'depthPrepass'

/** The water's depth: the scene's copied, the water drawn into the copy. Returns the draws encoded. */
export function encodeDepthPrepass(f: WaterFrame) {
  if (!f.prepass) return 0
  const { encoder, rt, device, width, height } = f
  copySceneDepth(f)
  const pass = encoder.beginRenderPass({
    label: WATER_DEPTH_PASS,
    colorAttachments: [],
    depthStencilAttachment: {
      view: f.targets.views.waterDepth,
      depthLoadOp: 'load',
      depthStoreOp: 'store',
    },
  })
  pass.setViewport(0, 0, width, height, 0, 1)
  const drawn = drawBlendRuns(
    rt,
    device,
    pass,
    { at: (rank) => f.pipelines.depth(rank) },
    { water: 'only', reflected: false },
  )
  pass.end()
  return drawn + (velocityInPrepass(f) ? encodeVelocity(f) : 0)
}

/** The scene without the water: its linear depth, at the refraction's downsample. Returns the draws encoded. */
export function encodeSceneDepth(f: WaterFrame) {
  const pipeline = f.stages.depthCopy.pipeline.get()
  if (!pipeline) return 0
  const pass = f.encoder.beginRenderPass({
    label: WATER_COPY_PASS,
    colorAttachments: [colour(f.targets.views.sceneDepth)],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, f.scene.copy)
  pass.draw(3)
  pass.end()
  return 1
}

/** The tiles that hold water, marked then listed. Returns the passes encoded. */
export function encodeTileList(f: WaterFrame) {
  if (!f.listed) return 0
  const { encoder, targets, stages } = f
  // The subgroup variant, compiled at its first ask: the plain list until it is ready.
  const waved = f.settings.singleLayerWaterWaveOps ? stages.waved() : undefined
  const marks = stages.marks.get(),
    lists = (waved?.ready ? waved : (waved?.ask(), stages.lists)).get()
  if (!marks || !lists) return 0
  encoder.clearBuffer(targets.tileMask)
  encoder.clearBuffer(targets.tileArgs, 4, 4)
  const tiles = encoder.beginComputePass(WATER_TILES_PASS_DESCRIPTOR)
  tiles.setBindGroup(0, f.scene.kernels)
  tiles.setPipeline(marks)
  tiles.dispatchWorkgroups(targets.tilesAcross, targets.tilesDown)
  tiles.setPipeline(lists)
  tiles.dispatchWorkgroups(
    ceilDiv(targets.tilesAcross, WATER_TILE_PIXELS),
    ceilDiv(targets.tilesDown, WATER_TILE_PIXELS),
  )
  tiles.end()
  return 2
}

/** The scene's colour, over the target or over the listed tiles alone. Returns the draws encoded. */
export function encodeColourCopy(f: WaterFrame) {
  const { stages, targets } = f
  const { tiledCopy } = f
  const pipeline = (tiledCopy ? stages.colorTiled : stages.color).pipeline.get()
  if (!pipeline) return 0
  const pass = f.encoder.beginRenderPass({
    label: WATER_COPY_PASS,
    colorAttachments: [colour(targets.views.sceneColor, !tiledCopy)],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, f.scene.copy)
  if (tiledCopy) pass.drawIndirect(targets.tileArgs, 0)
  else pass.draw(3)
  pass.end()
  return 1
}

/** The mask of the refraction, where a culling asks for it. Returns the draws encoded. */
export function encodeRefractionMask(f: WaterFrame) {
  const pipeline = f.stages.mask.pipeline.get()
  if (!(f.masked && f.prepass) || !pipeline) return 0
  const pass = f.encoder.beginRenderPass({
    label: WATER_MASK_PASS,
    colorAttachments: [colour(f.targets.views.mask)],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, f.scene.mask)
  pass.draw(3)
  pass.end()
  return 1
}

/** The colour targets of the shading: the image, the request, the surface and the separated sun. */
function shadeAttachments(f: WaterFrame) {
  const { views } = f.targets
  return [
    colour(f.hdrView, false),
    f.rt.vis.writesFeedback ? feedbackAttachment(f.rt) : null,
    colour(views.normals),
    colour(views.specular),
    ...(f.pipelines.separate ? [colour(views.sun!)] : []),
  ]
}

/** The water shaded over the scene: volume, lights and fog, its surface written beside. Without the depth
 *  pass the scene's depth is kept before and after it. Returns the draws encoded. */
export function encodeShading(f: WaterFrame) {
  const { encoder, targets, prepass } = f
  if (!prepass) copySceneDepth(f)
  const pass = encoder.beginRenderPass({
    label: WATER_PASS,
    colorAttachments: shadeAttachments(f),
    depthStencilAttachment: prepass
      ? { view: targets.views.waterDepth, depthReadOnly: true }
      : { view: f.depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
  })
  pass.setViewport(0, 0, f.width, f.height, 0, 1)
  pass.setBindGroup(WATER_GROUP, targets.shadeGroup)
  let drawn = drawBlendRuns(
    f.rt,
    f.device,
    pass,
    { at: (rank) => f.pipelines.shade(rank, !prepass) },
    { water: 'only' },
  )
  pass.end()
  if (f.settings.singleLayerWaterVelocityOutputPass !== 'none' && !velocityInPrepass(f))
    drawn += encodeVelocity(f)
  if (!prepass) copySceneDepth(f)
  return drawn
}

/** The reflection of the water's surface added over the water, over the target or the listed tiles.
 *  Returns the draws encoded. */
export function encodeComposite(f: WaterFrame) {
  if (!(f.reflects || f.separated)) return 0
  const { rt, device, targets } = f
  const pipeline = f.pipelines.composite(f.tiledComposite)
  if (!pipeline) return 0
  const pass = f.encoder.beginRenderPass({
    label: WATER_COMPOSITE_PASS,
    colorAttachments: [colour(f.hdrView, false)],
  })
  pass.setViewport(0, 0, f.width, f.height, 0, 1)
  pass.setBindGroup(0, sharedBlendGroup(rt, device))
  bindForwardReflection(pass, rt, skyLightReadOf(rt))
  pass.setBindGroup(
    WATER_GROUP,
    waterCompositeGroup(device, targets, rt.blendState.waterSun?.state.mask),
  )
  pass.setPipeline(pipeline)
  if (f.tiledComposite) pass.drawIndirect(targets.tileArgs, 0)
  else pass.draw(3)
  pass.end()
  return 1
}

/** The water's depth is the scene's from here on, so that every layer drawn after is hidden by it. */
export function handOverDepth(f: WaterFrame) {
  if (!f.prepass) return
  f.encoder.copyTextureToTexture(
    { texture: f.targets.waterDepth },
    { texture: f.depthTexture },
    f.extent,
  )
}
