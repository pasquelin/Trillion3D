import {
  createEngineCamera,
  holdCameraWorld,
  sameOccluderView,
  type HostCamera,
} from '../../../camera/world.ts'
import { renderGpuCut } from './gpuCut.ts'
import { uploadWorlds } from './worldUpload.ts'
import { setWindingEpoch } from './winding.ts'
import { holdWebgpuFrame } from '../../frame/hold.ts'
import { frameTargetsAwaited, requestFrameTargets } from '../prepare/targetGrant.ts'
import { deviceAnswering } from '../../frame/deviceAnswer.ts'
import { pumpResidentTiles } from '../prepare/lightResources.ts'
import { refreshBlendBoxes } from '../../blend/hierarchy.ts'
import { refreshBlendScene } from '../../blend/resources.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { followLiveTextures } from '../io/memory.ts'
import { followFeedback } from '../prepare/feedbackVariant.ts'
import { beginTaaFrame } from '../../../taa/frame.ts'
import { restartTaaOnLanding } from '../../../taa/landing.ts'
import { frameStart } from '../../../frame/scheduling.ts'
import { askFramePipelines } from '../../frame/framePipelines.ts'
import { adoptGrownCut } from '../../../placement/webgpuGrownCut.ts'
import { startGrownCut } from '../../../placement/webgpuGrowth.ts'

/** Renders one image: refreshes the scene inputs a row depends on, then hands the frame to the GPU
 *  cut, the engine's one cut (#1483), whichever view is drawn. */
export function renderWebgpuPages(rt: WebgpuPagesRuntime, camera: HostCamera, aspect?: number) {
  const { run } = rt
  const gpuDevice = enterImage(rt, camera, aspect)
  // Targets that no longer fit the view are asked; the frame is held until granted.
  void requestFrameTargets(rt, gpuDevice)
  const pixelError = run.gate.pixelError,
    cam = run.gate.cam
  followSceneInputs(rt, gpuDevice)
  // Neither the scene, nor the view, nor the resources have moved, and nothing is in flight: the
  // previous image is this one. No CPU step is run below.
  // A frame the device still answers for (targets, shadow pool) is held even when forced.
  if (rt.feedbackAB?.force && !frameTargetsAwaited(rt) && !deviceAnswering(rt)) {
    // Replay the settled TAA sample and history while forcing the real GPU passes.
    beginTaaFrame(rt, run.gate.cam, true)
    run.frameHeld = false
  } else if (holdWebgpuFrame(rt, gpuDevice)) return
  drawFrameInputs(rt, gpuDevice, pixelError, cam)
  const cpuStart = performance.now()
  // No more scene light is packed per image: declared lamps live in a store that encoding only
  // pushes to the GPU if its revision has moved (P6). The CPU "Lights" step is therefore zero
  // because the work has disappeared, not because it is not measured.
  const lightsEnd = cpuStart
  resetFrameCounters(run)
  // The impostor plan: the cards, and the card bit of the roots they replace, read by the cut.
  rt.gpu.impostorCode?.planWebgpuImpostors(rt, cam)
  renderGpuCut(rt, cam, pixelError, cpuStart, lightsEnd)
}

/** The image's entry: the session checked, the grown placements joined, the scale paced and the
 *  gate entered. Returns the device the image draws on. */
function enterImage(rt: WebgpuPagesRuntime, camera: HostCamera, aspect: number | undefined) {
  const { run, gpu, capture, context } = rt,
    { source } = rt.setup,
    gpuDevice = gpu.device
  if (capture.capturing && !capture.surfaceRenderAllowed) throw new Error('SURFACE_CAPTURE_BUSY')
  if (context.signal?.aborted) context.signal.throwIfAborted()
  if (run.lost) throw new Error('WEBGPU_LOST')
  if (!gpuDevice || !gpu.cache) throw new Error('WEBGPU_UNAVAILABLE')
  rt.timing.marks.preStart = performance.now()
  // Placements grown in place join with the cut made over them, between two images; the growths
  // since the last image ask one cut more, made beside this one.
  adoptGrownCut(rt)
  startGrownCut(rt)
  // The display's cadence, read on the main view's frames at the frame's rAF timestamp: the
  // render-scale budget, and its cost where the device cannot timestamp.
  if (rt.views.active === rt.views.main && !capture.capturing)
    rt.scale.tick(frameStart(), rt.timing.gpuTiming?.supported === true)
  run.lastCamera = camera
  // Image entry: order and its guarantees live in `../../../frame/gateCore.ts`, which also copies the host
  // camera into the engine's — everything that follows only reads the latter. The list of nodes
  // the host can write is only built at a scene change, never per image — twelve instances of the
  // same model re-read that model once.
  run.gate.enterFrame(
    context,
    camera,
    run.motion,
    rt.setup.viewport,
    source,
    rt.watchedSources,
    aspect,
  )
  return gpuDevice
}

/** The scene inputs followed before the hold: the atlases' records, the live textures, the
 *  feedback output and the pipelines asked. */
function followSceneInputs(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis } = rt
  // The atlases' records brought up to their host textures once for the image (#360, #361): a
  // sampling or a placement moved rewrites the texture's header, a resource change that releases a
  // held image. A filter rule switched on or off moves the resolve class of the pages that wear
  // the texture (`FLAG_SAMPLED`): their rows and the transparent records are written again.
  if (vis.textures?.followSampling()) {
    rt.layout.rows.tableEpoch++
    vis.shadeCensus?.moved()
    refreshBlendScene(rt, gpuDevice)
  }
  followLiveTextures(rt)
  // Textures that came or went switch the pipelines' feedback output, the target following.
  followFeedback(rt, gpuDevice)
  // What entered the scene since has its pipelines asked, compiled off the thread: the frame is
  // held on them below (`deviceAnswering`), never compiles one.
  askFramePipelines(rt)
}

/** What a drawn frame brings up before its cut: tiles, worlds, deformation, the view the occluder
 *  history follows and the transparent scene. */
function drawFrameInputs(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  pixelError: number,
  cam: WebgpuPagesRuntime['run']['gate']['cam'],
) {
  const { run, vis, gpu, blendState } = rt,
    marks = rt.timing.marks
  // This frame is drawn: the canvas holds its display colour only once the frame presents it.
  gpu.presenter?.forget()
  run.diagnosticPixelError = pixelError
  // Nothing is held by default: only adoption of an already-read readback declares it, and every
  // path that does not go through it — a pending image, a view's first cut — remakes everything.
  run.cutHeld = false
  setWindingEpoch(rt.layout.rows.tableEpoch)
  // What the previous image's feedback requested becomes resident, under the budgets. The pass
  // times itself on its budget clock — the one bound the textures stage reads —; the marks only
  // keep `worldMs` below to the world step alone.
  marks.gateEnd = performance.now()
  restartTaaOnLanding(rt, pumpResidentTiles(vis.textures, run.frame, run.textureConverging))
  marks.tilesEnd = performance.now()
  const worldsMoved = uploadWorlds(rt, cam)
  // The GPU deformation of this image, on the poses just uploaded (#357).
  rt.vis.deformationCode?.updateWebgpuDeformation(rt, cam, worldsMoved)
  // A moved view lets every row the GPU partition kept leave the occluders again; while it stands
  // still, the halves converge under the antialiasing jitter and an image can be held.
  run.occluderViewMoved = !sameOccluderView(run.previousOccluderView, cam)
  // The world pose is copied into the already-held camera: no clone per image.
  if (run.occluderViewMoved)
    run.previousOccluderView = holdCameraWorld(
      run.previousOccluderView ?? createEngineCamera(),
      cam,
    )
  marks.blendStart = performance.now()
  // A transparent item READS the world matrix of its source mesh: nothing is to be copied. Only
  // its world box, which is a computation, is remade — and only when the scene has changed matrices.
  if (worldsMoved && gpuDevice) {
    refreshBlendBoxes(blendState)
    // Records, boxes and the plan follow the scene, not the camera: it is here, and nowhere in
    // the image, that the transparent list is walked again — its poses alone while no material
    // moved (`refreshBlendScene`).
    refreshBlendScene(rt, gpuDevice, true)
  }
}

/** The image's counters, zeroed before its cut. */
function resetFrameCounters(run: WebgpuPagesRuntime['run']) {
  run.overBudget = false
  run.submittedTriangles = 0
  run.blendPagedTriangles = 0
  run.blendUnpagedTriangles = 0
  run.blendSubmittedTriangles = 0
  run.blendDrawCalls = 0
  run.frame++
  run.feedbackWritten = false
  run.hizPyramidFresh = false
  run.gpuMetricsReady = false
}
