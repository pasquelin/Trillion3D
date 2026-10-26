import { blueNoiseMade } from '../../gpu/noise/blueNoiseTextures.ts'
import { cpuNow } from '../../diagnostic/stopwatch.ts'
import type { ViewCamera } from '../../camera/world.ts'
import { renderGpuCut } from './gpuCut.ts'
import { uploadWorlds } from './worldUpload.ts'
import { holdWebgpuFrame } from '../loop/hold.ts'
import { followFirstImage } from '../loop/firstImage.ts'
import { frameTargetsAwaited, requestFrameTargets } from '../prepare/targetGrant.ts'
import { deviceAnswering } from '../loop/deviceAnswer.ts'
import { refreshBlendWorlds } from '../../blend/worlds.ts'
import { refreshBlendScene } from '../../blend/sceneRefresh.ts'
import { followBlendScene } from '../../blend/resources.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { followLiveTextures } from '../io/memory.ts'
import { followFeedback } from '../prepare/feedbackVariant.ts'
import { followModelSwitches } from '../prepare/lobesTarget.ts'
import { beginTaaFrame } from '../../post/taa/frame.ts'
import { frameStart } from '../scheduling.ts'
import { askFramePipelines } from '../loop/framePipelines.ts'
import { adoptGrownCut } from '../../placement/webgpuGrownCut.ts'
import { startGrownCut } from '../../placement/growth/grownCutStart.ts'
import { takeGraphClocks } from '../../materials/graph/clocks.ts'
import { followShadowSettings } from '../../lighting/shadows/vsm/frame/vsmFarShadow.ts'
import { followOffsets } from './offsetReach.ts'

/** Renders one image: refreshes the scene inputs a row depends on, then hands the frame to the GPU
 *  cut, the engine's one cut (#1483), whichever view is drawn. */
export function renderWebgpuPages(rt: WebgpuPagesRuntime, camera: ViewCamera, aspect?: number) {
  const { run } = rt
  const gpuDevice = enterImage(rt, camera, aspect)
  // The poses the last drawn frame drew are kept as the main view's image opens the frame, held or
  // drawn, before it sends one: every view's main pass of the frame tests against them, and every
  // velocity measures from them (`../../geometry/dag/previousPoses.ts`).
  if (rt.views.active === rt.views.main) run.gpuSelection?.keepPoses()
  // Targets that no longer fit the view are asked; the frame is held until granted.
  void requestFrameTargets(rt, gpuDevice)
  // A view that asks more detail (`ViewOverrides.lodScale`) cuts at a finer tolerance, one of 1 as is.
  const pixelError = run.gate.pixelError / rt.views.active.overrides.lodScale,
    cam = run.gate.cam
  followSceneInputs(rt, gpuDevice)
  // The session's images are shown from the first drawn once the main view has loaded.
  followFirstImage(rt)
  // Neither the scene, nor the view, nor the resources have moved, and nothing is in flight: the
  // previous image is this one. No CPU step is run below.
  // A frame the device still answers for (targets, shadow pool) is held even when forced.
  if (rt.feedbackAB?.force && !frameTargetsAwaited(rt) && !deviceAnswering(rt)) {
    // Replay the settled TAA sample and history while forcing the real GPU passes.
    beginTaaFrame(rt, run.gate.cam)
    run.frameHeld = false
  } else if (holdWebgpuFrame(rt, gpuDevice)) return
  // Drawn: the next frame keeps the poses this one draws at.
  run.gpuSelection?.posesDrawn()
  drawFrameInputs(rt, gpuDevice, pixelError, cam)
  const cpuStart = cpuNow()
  resetFrameCounters(rt)
  renderGpuCut(rt, cam, pixelError, cpuStart)
}

/** The image's entry: the session checked, the grown placements joined, the scale paced and the
 *  gate entered. Returns the device the image draws on. */
function enterImage(rt: WebgpuPagesRuntime, camera: ViewCamera, aspect: number | undefined) {
  const { run, gpu, capture, context } = rt,
    { source } = rt.setup,
    gpuDevice = gpu.device
  if (capture.capturing && !capture.surfaceRenderAllowed) throw new Error('SURFACE_CAPTURE_BUSY')
  if (context.signal?.aborted) context.signal.throwIfAborted()
  if (run.lost) throw new Error('WEBGPU_LOST')
  if (!gpuDevice || !gpu.cache) throw new Error('WEBGPU_UNAVAILABLE')
  rt.timing.marks.preStart = cpuNow()
  // Placements grown in place join with the cut made over them, between two images; the growths
  // since the last image ask one cut more, made beside this one.
  adoptGrownCut(rt)
  startGrownCut(rt)
  // The display's cadence, read on the main view's frames at the frame's rAF timestamp: the
  // render-scale budget, and its cost where the device cannot timestamp.
  if (rt.views.active === rt.views.main && !capture.capturing) {
    rt.views.main.scale.tick(frameStart(), rt.timing.gpuTiming?.supported === true)
    rt.views.mainImages++
  }
  run.lastCamera = camera
  // Image entry: order and its guarantees live in `../gate/gateCore.ts`, which also copies the host
  // camera into the engine's — everything that follows only reads the latter. The list of nodes
  // the host can write is only built at a scene change, never per image — twelve instances of the
  // same model re-read that model once.
  run.gate.enterFrame(context, camera, rt.setup.viewport, source, rt.watchedSources, aspect)
  return gpuDevice
}

/** The scene inputs followed before the hold: the atlases' records, the surfaces' records, the
 *  live textures, the feedback output and the pipelines asked. */
function followSceneInputs(rt: WebgpuPagesRuntime, gpuDevice: GPUDevice) {
  const { vis } = rt
  // The atlases' records brought up to their host textures once for the image (#360, #361): a
  // sampling or a placement moved rewrites the texture's header, a resource change that releases a
  // held image. A filter rule switched on or off moves the resolve class of the pages that wear
  // the texture (`FLAG_SAMPLED`): their clusters' records and the transparent records are written again. So
  // does a surface rewritten since in what its clusters read beside its record — a flag, its class —
  // (`follow`, `../../materials/table/materialTable.ts`): a colour, a factor, a map's slot writes its one
  // record and no cluster's.
  const sampling = !!vis.textures?.followSampling()
  if (vis.materialTable.follow(vis) || sampling) {
    rt.layout.clusters.infoEpoch++
    vis.shadeCensus?.moved()
    followBlendScene(rt, gpuDevice)
  }
  followLiveTextures(rt)
  // The shadow settings are the view's quality: a change moves the view's revision before the hold.
  followShadowSettings(rt)
  // The surfaces' format turned since the last image: the scene moved in place.
  followModelSwitches(rt)
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
  const { run, gpu, blendState } = rt,
    marks = rt.timing.marks
  // This frame is drawn: the canvas holds its display colour only once the frame presents it.
  gpu.presenter?.forget()
  run.diagnosticPixelError = pixelError
  // Nothing is held by default: only adoption of an already-read readback declares it, and every
  // path that does not go through it — a pending image, a view's first cut — remakes everything.
  run.cutHeld = false
  marks.gateEnd = cpuNow()
  const worldsMoved = uploadWorlds(rt)
  // The GPU deformation of this image, on the poses just uploaded (#357).
  rt.vis.deformationCode?.updateWebgpuDeformation(rt, cam)
  // The reach the surfaces' offsets add to their roots' bounds, and the shadows they stale.
  followOffsets(rt)
  marks.blendStart = cpuNow()
  // A transparent item READS the world matrix of its source mesh: nothing is to be copied. Only
  // its world box, which is a computation, is remade — and only when the scene has changed matrices.
  if ((worldsMoved || blendState.proxiesMoved) && gpuDevice) {
    // A blended row turned to draw as its HLOD 0 actor or back writes its items' flags too.
    blendState.proxiesMoved = false
    if (worldsMoved) refreshBlendWorlds(blendState.blendGpu)
    // Records, boxes and the plan follow the scene, not the camera: it is here, and nowhere in
    // the image, that the transparent list is walked again — its poses alone while no material
    // moved (`refreshBlendScene`).
    refreshBlendScene(rt, gpuDevice, true)
  }
}

/** The image's counters, zeroed before its cut, and the clocks its graphs read, taken once and given
 *  to the masks that read them. */
function resetFrameCounters({ run, context, vis, gpu }: WebgpuPagesRuntime) {
  run.overBudget = false
  run.submittedTriangles = 0
  run.blendPagedTriangles = 0
  run.blendSubmittedTriangles = 0
  run.blendDrawCalls = 0
  run.frame++
  takeGraphClocks(run.graphClocks, context.worldClock)
  // The masks that read a clock, and the offsets that move vertices, read the clocks and the camera
  // from the graph frame every raster binds (`graphFrameWgsl.ts`).
  const device = gpu.device
  vis.graphFrame.write(
    device,
    run.graphClocks,
    run.gate.cam.eye,
    !!device && !!blueNoiseMade(device),
  )
  run.feedbackWritten = false
  run.hizPyramidFresh = false
  run.depthDrawn = false
  run.gpuMetricsReady = false
}
