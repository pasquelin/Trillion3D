import { visUniformLayout } from '../../gpu/bind/bindLayout.ts'
import { viewProj } from '../../frame/backend/helpers.ts'
import { slotCount } from '../bins/contract.ts'
import type { WebgpuVisState } from '../../frame/backend/state/vis.ts'
import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import { verifyImages } from '../../materials/virtual/convergeRules.ts'
import { taaPhaseCount } from '../../post/taa/frame.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import {
  SHADING,
  markShadingDrawn,
  switchOn,
  writeNormalCurvature,
} from '../../materials/surface/pixelModel.ts'
import { SHADE_UNIFORM_BYTES } from '../shader/request.ts'
import { SHADE_UNIFORM, VIS_UNIFORM } from '../shader/uniformLayout.ts'
import { writeDepthRamp } from '../../camera/depthConvention.ts'
import { renderMipBias, renderPixelRatio } from '../../frame/backend/state/renderScale.ts'
import { diagnosticCode } from '../shader/shadeMode.ts'
import { wordViews } from '../../gpu/core/wordViews.ts'
import { viewClipRoutes, writeViewClipPlane } from '../../frame/render/viewClip.ts'
import { tessellationWanted } from '../tessellation/wanted.ts'
import { holdoutOn } from '../../frame/prepare/alphaHoldout.ts'

/** One entry per indirect draw slot, plus the direct path's first. Size follows the
 *  scene's coplanar-layer count: with no layer, one layer's `BASE_SLOTS`. */
export const visUniformSlots = (vis: Pick<WebgpuVisState, 'drawLayerSlots'>) =>
  slotCount(vis.drawLayerSlots) + 1

/** Highest coplanar layer an indirect slot names. The slot count is `1 + min(deepest layer,
 *  MAX_DEPTH_LAYER)` and falls back to 1 on any failure: it never goes below 1, so the top never goes
 *  below 0. */
export const visLayerTop = (vis: WebgpuVisState) => vis.drawLayerSlots - 1

const U = VIS_UNIFORM.at,
  SHADE = SHADE_UNIFORM.at
/** The words every slot holds alike, built each image and compared with what slot 0 holds. */
const shared = new Float32Array(VIS_UNIFORM.words),
  sharedInts = wordViews(shared.buffer).u

/** The words every slot holds alike, built from the view into `shared`. */
function fillShared(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  width: number,
  height: number,
  pixelRatio: number,
  mipBias: number,
  tableRows: number,
) {
  shared.fill(0)
  shared.set(viewProj, U.viewProj)
  shared[U.viewport] = width
  shared[U.viewport + 1] = height
  // The tessellation's camera (`../tessellation/viewWgsl.ts`): its eye and forward axis in the world
  // the clusters' matrices place pages in, the view's -z, its near plane and projection weight.
  shared[U.near] = cam.near
  shared[U.perspective] = cam.perspective
  // The projection's scale on each axis, whose pixel rays the depth offset counts along the view axis.
  shared[U.focal] = cam.projection[0]!
  shared[U.focal + 1] = cam.projection[5]!
  shared[U.depthSpan] = cam.perspective === 0 ? cam.far - cam.near : 0
  shared.set(cam.eye, U.eye)
  shared[U.forward] = -cam.view[2]!
  shared[U.forward + 1] = -cam.view[6]!
  shared[U.forward + 2] = -cam.view[10]!
  // Whether the clusters that name a displacement are tessellated (`../tessellation/rowWgsl.ts`): the
  // cut leaves them to it and the resolve solves their pixels on the displaced surface.
  sharedInts[U.tessellation] = tessellationWanted(rt) ? 1 : 0
  // The view's clip plane in the world the clusters are placed in, zeros for a view that clips
  // nothing, and whether the cut's cull of the plane is on.
  writeViewClipPlane(rt, cam, shared, U.clipPlane)
  sharedInts[U.clipRoute] = viewClipRoutes(rt, cam) ? 1 : 0
  // Render pixels per CSS pixel: a line page's width counts CSS pixels (`lineClip`).
  shared[U.pixelRatio] = pixelRatio
  // Texture level offset of a frame drawn below the display (`tilePoolWgsl`).
  shared[U.mipBias] = mipBias
  sharedInts[U.pageCount] = tableRows
}

/** Uploads visibility and material resolve uniforms for the current cut, creating the two uniform
 *  buffers on `rt.vis` the first time. A slot differs from the next by its two words alone
 *  (`drawSlot`, `indirect`), fixed by its number: they are written when the slots are made, the
 *  rest is built once, copied to every slot, and uploaded only when it changed. `tableRows` is the
 *  clusters the decoded table holds room for. */
export function writeWebgpuVisibilityUniforms(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  tableRows: number,
) {
  const { vis } = rt,
    slots = visUniformSlots(vis),
    layout = visUniformLayout(device.limits, slots),
    slotWords = layout.strideWords
  const made = vis.visUniPacked.length !== slots * slotWords || !vis.visUniform
  if (vis.visUniPacked.length !== slots * slotWords)
    vis.visUniPacked = new Float32Array(slots * slotWords)
  const { visUniPacked } = vis,
    [width, height] = rt.gpu.targetSize,
    pixelRatio = renderPixelRatio(rt),
    mipBias = renderMipBias(rt)
  const visUniform = (vis.visUniform ??= device.createBuffer({
    size: layout.bytes,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
  const visInts = wordViews(visUniPacked.buffer, visUniPacked.byteOffset).u
  fillShared(rt, cam, width, height, pixelRatio, mipBias, tableRows)
  let changed = made
  for (let word = 0; word < shared.length; word++) {
    if (word === U.drawSlot || word === U.indirect) continue
    if (visInts[word] !== sharedInts[word]) {
      changed = true
      break
    }
  }
  if (changed) {
    for (let slot = 0; slot < slots; slot++) {
      const base = slot * slotWords
      for (let word = 0; word < shared.length; word++)
        if (word !== U.drawSlot && word !== U.indirect) visInts[base + word] = sharedInts[word]
      if (made) {
        visInts[base + U.drawSlot] = Math.max(0, slot - 1)
        visInts[base + U.indirect] = slot === 0 ? 0 : 1
      }
    }
    device.queue.writeBuffer(visUniform, 0, visUniPacked)
  }
  writeShadeUniform(rt, device, cam, tableRows, pixelRatio, mipBias)
}

/** Uploads the material resolve's uniform for the current cut (`SHADE_UNIFORM`): the camera, the
 *  viewport, the page count, the depth ramp, what a material graph reads of the view — the
 *  camera in the world and the clocks in seconds (`run.graphClocks`) — and the shading models'
 *  switches (`irisNormal`, `clearCoatNormal`). */
function writeShadeUniform(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  cam: EngineCamera,
  tableRows: number,
  pixelRatio: number,
  mipBias: number,
) {
  const { vis, run } = rt,
    { shadeUniPacked } = vis,
    [width, height] = rt.gpu.targetSize
  const shadeUniform = (vis.shadeUniform ??= device.createBuffer({
    size: SHADE_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  }))
  shadeUniPacked.set(viewProj, SHADE.viewProj)
  shadeUniPacked[SHADE.viewport] = width
  shadeUniPacked[SHADE.viewport + 1] = height
  shadeUniPacked[SHADE.pixelRatio] = pixelRatio
  shadeUniPacked[SHADE.mipBias] = mipBias
  const shadeInts = wordViews(shadeUniPacked.buffer, shadeUniPacked.byteOffset).u
  shadeInts[SHADE.pageCount] = tableRows
  // Texture image-feedback phase: one pixel in 256 speaks, all of them during a convergence and while the last tiles served are verified (`verifying`).
  shadeInts[SHADE.feedback] =
    vis.textures?.feedback.phaseWord(
      run.textureConverging || vis.textures.counters.verifying(verifyImages(taaPhaseCount(rt))),
    ) ?? 0
  // The depth material's ramp: white at the near plane, black at the far one.
  const { near, far, perspective } = run.gate.cam
  writeDepthRamp(shadeUniPacked, SHADE.depthRamp, near, far, perspective)
  shadeInts[SHADE.mode] = diagnosticCode(run.diagnostic)
  shadeUniPacked[SHADE.pixelError] = run.diagnosticPixelError
  // The voxel classes count their trace's steps on a sampled frame (`voxelSteps.ts`).
  shadeInts[SHADE.voxelCounting] = vis.voxelSteps?.due(run.frame) ? 1 : 0
  // What a material graph reads of the view: the camera in the world, the clocks in seconds.
  shadeUniPacked.set(cam.eye, SHADE.eye)
  shadeUniPacked[SHADE.time] = run.graphClocks.time
  shadeUniPacked[SHADE.realTime] = run.graphClocks.realTime
  shadeInts[SHADE.frameIndex] = noiseFrame(rt)
  // The eye's iris and the clear coat: whether the pass leaves them a normal of their own (the lighting reads the same settings).
  // The words are kept: a setting that turns since moves the scene (`followModelSwitches`, `../../frame/prepare/lobesTarget.ts`).
  const { shading } = run
  const switches = shading[SHADING.switches]
  markShadingDrawn(run)
  shadeInts[SHADE.irisNormal] = switchOn(switches, 'irisNormal')
  shadeInts[SHADE.clearCoatNormal] = switchOn(switches, 'clearCoatNormal')
  // The alpha holdout: a held-out primitive's pixels are black and lit by nothing while it is in effect.
  shadeInts[SHADE.holdout] = holdoutOn(rt) ? 1 : 0
  // The curve a material's normal curvature takes its roughness by.
  writeNormalCurvature(shading, shadeUniPacked, SHADE.normalCurvature)
  device.queue.writeBuffer(shadeUniform, 0, shadeUniPacked)
}
