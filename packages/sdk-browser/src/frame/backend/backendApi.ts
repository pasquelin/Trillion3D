import type { Engine, EngineContext } from '../../session/engine/types.ts'
import type { WebgpuPagesRuntime } from './runtime.ts'
import { prepareWebgpuBackend } from '../prepare/prepare.ts'
import { setWebgpuBounce } from '../prepare/bounce.ts'
import { setWebgpuTemporalAntialiasing } from '../../post/taa/prepare.ts'
import { flushWebgpuPages } from '../render/flush.ts'
import { captureSurfaceView } from '../io/surfaceCapture.ts'
import { captureColorView } from '../io/colorCapture.ts'
import { castWebgpuRay } from '../io/castRay.ts'
import {
  addWebgpuView,
  removeWebgpuView,
  renderWebgpuView,
  resizeWebgpuView,
} from './state/persistentView.ts'
import { captureImage, rasterView, syncResident } from '../io/hostApi.ts'
import { freezeWebgpuCut } from '../render/cutFreeze.ts'
import { pendingUrls, retainedRanks } from '../io/hostLists.ts'
import { acceptPage, dropPage } from '../io/pageApi.ts'
import { createArrivalSpecs } from '../../geometry/integration/arrivalSpecs.ts'
import { endCpuFrame, hostCpuStep } from '../render/cpuSteps.ts'
import { setWebgpuTransform, setWebgpuTransforms } from '../render/transform.ts'
import { webgpuPlacementApi } from '../../placement/growth/webgpuGrowth.ts'
import { composeWebgpuPlacements } from '../../placement/compose/gpuCompose.ts'
import { webgpuVertexApi } from './dynamicVertices.ts'
import { disposeWebgpuPages, metricsOf } from '../io/metrics.ts'
import { setWebgpuMemoryBudgets } from '../io/memory.ts'
import { hostTableBytesOf } from '../io/besidePools.ts'
import { runtimeMaterialApi } from '../io/runtimeMaterialApi.ts'
import { addWebgpuPlacements } from '../../placement/append/webgpuAppend.ts'
import type { WorldRootsHold } from '../../geometry/hlod/worldRoots.ts'
import { addWebgpuWorldRoots } from '../../placement/append/webgpuAppendWorld.ts'
import { setWebgpuClearColor } from '../io/clearColor.ts'
import * as materials from '../io/refreshMaterials.ts'
import { installGpuDeviceLedger, gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts'
import { sweepSession } from '../io/sessionSweep.ts'
import { namesNoSession } from '../../gpu/core/sessionHandle.ts'
import { families } from '../../session/host/families.ts'
import { claimWebgpuDevice, markWebgpuLost } from '../io/lost.ts'
import type { GpuDeviceClaim } from '../../gpu/core/deviceOwners.ts'
import type { WorldCells } from '../../geometry/dag/worlds/worldCells.ts'
import {
  measureWebgpuFrame,
  pendingWebgpuFrame,
  skipsWebgpuFrame,
} from '../loop/interactiveFrame.ts'

const views = () => families.diagnostics.load()

/** The device this session holds until disposed, and its teardown once begun; `setup.preparing`
 *  is the running preparation. */
export type PagesSession = { claim?: GpuDeviceClaim; closing?: Promise<void> }

/** Each cut's world cells as the partition tells them: a cell told anew wakes the next image, which
 *  a still camera would hold (`../loop/hold.ts`) — one kept per cut, the partition's to compare. */
const wakingCells = new WeakMap<WorldCells, WorldCells>()
function wakingWorld(world: WorldCells, wake: () => void) {
  let waking = wakingCells.get(world)
  if (!waking) {
    waking = {
      show: (instance, cell, word) => world.show(instance, cell, word) && (wake(), true),
      visible: world.visible,
      fileShown: world.fileShown,
      fileSlot: world.fileSlot,
      get slotRevision() {
        return world.slotRevision
      },
      pageBase: world.pageBase,
      moved: world.moved,
      warmWith: world.warmWith,
      firstImageShown: world.firstImageShown,
      hlodEnabled: world.hlodEnabled,
      blockingLoad: world.blockingLoad,
      get warming() {
        return world.warming
      },
      get shown() {
        return world.shown
      },
      get revision() {
        return world.revision
      },
    }
    wakingCells.set(world, waking)
  }
  return waking
}

/** The engine's scene writes: transforms, bounce, antialiasing, scale, placements, vertices,
 *  materials, budgets, clear colour. */
export function backendSetters(rt: WebgpuPagesRuntime) {
  const { run } = rt
  return {
    setTransform: (nodeName, matrix) => setWebgpuTransform(rt, nodeName, matrix),
    setTransforms: (nodes, matrices) => setWebgpuTransforms(rt, nodes, matrices),
    setBounce: (on) => setWebgpuBounce(rt, on),
    setTemporalAntialiasing: (level) => setWebgpuTemporalAntialiasing(rt, level),
    setRenderScale: (scale) =>
      void (rt.views.main.scale.set(scale), rt.run.gate.resourcesChanged()),
    renderScale: () => rt.views.main.scale.drawn,
    setMaxFrameRate: (rate) => void (rt.views.main.scale.maxFrameRate = rate),
    ...webgpuPlacementApi(rt),
    composePlacements: (parent, world, links, whole) =>
      composeWebgpuPlacements(rt, parent, world, links, whole),
    worldCells(roots) {
      const world = roots && rt.context.worldRoots === roots ? run.gpuSelection?.world : undefined
      return world && wakingWorld(world, run.gate.resourcesChanged)
    },
    ...webgpuVertexApi(rt),
    refreshMaterials: (values, alpha) => materials.refreshWebgpuMaterials(rt, values, alpha),
    materialClassRefusal: (alpha) => materials.webgpuMaterialClassRefusal(alpha, rt.setup.allPages),
    wearSurface: (assignment) => materials.wearWebgpuSurface(rt, assignment),
    setMemoryBudgets: (budgets) => setWebgpuMemoryBudgets(rt, budgets),
    addPlacements: (source, primitive) => addWebgpuPlacements(rt, source, primitive),
    addTextureCaches: (caches) => rt.context.textureCaches.add(...caches),
    addWorldRoots: (roots) => addWebgpuWorldRoots(rt, roots as WorldRootsHold),
    ...runtimeMaterialApi(rt),
    setClearColor: (hex) => setWebgpuClearColor(rt, hex),
  } satisfies Partial<Engine>
}

/** The session claims its device and prepares the engine through it (`Engine.prepare`). */
export async function prepareSession(
  rt: WebgpuPagesRuntime,
  context: EngineContext,
  session: PagesSession,
) {
  rt.signal.throwIfAborted()
  const { gpuDevice } = context
  if (!gpuDevice) throw new Error('WEBGPU_UNAVAILABLE')
  // The session creates through its own handle, whose labels name it; the allocation ledger
  // sits on it, above the tags, and carries the device's, which counts the shared caches.
  const claim = (session.claim = claimWebgpuDevice(rt, gpuDevice))
  const base = installGpuDeviceLedger(gpuDevice, { counts: namesNoSession })
  installGpuDeviceLedger(claim.device, { base, limit: context.admitGpuMemory?.limit })
  const building = prepareWebgpuBackend(rt, claim.device)
  rt.setup.preparing = building.catch(() => {})
  try {
    await building
  } catch (error) {
    rt.diag.diagnosticFailure('webgpu-prepare-failed', error)
    throw error
  } finally {
    rt.setup.preparing = undefined
  }
}

/** Inert and read as lost at once; torn down once, after the preparation stopped, then swept
 *  (`sweepSession`). */
export function disposeSession(rt: WebgpuPagesRuntime, session: PagesSession) {
  const { setup } = rt
  rt.closer.abort()
  gpuDeviceLedgerOf(session.claim?.device)?.releaseAdmission()
  session.claim?.release()
  markWebgpuLost(rt)
  return (session.closing ??= (
    setup.preparing ? setup.preparing.then(() => disposeWebgpuPages(rt)) : disposeWebgpuPages(rt)
  ).finally(() => sweepSession(session)))
}

/** What the host reads and asks of the engine: frames, captures, views, pages, metrics. */
export function backendHostApi(rt: WebgpuPagesRuntime) {
  const { run } = rt
  return {
    syncResident: () => syncResident(rt),
    // The feedback A/B measurements, diagnostic views on demand (`../../session/host/families.ts`).
    setFeedbackTargetAb: async (target) => (await views()).setFeedbackTargetAb(rt, target),
    feedbackAbResidency: async () => (await views()).feedbackAbResidency(rt),
    captureFeedbackAb: async () => (await views()).captureFeedbackAb(rt),
    feedbackAbSpatial: async () => (await views()).feedbackAbSpatial(rt),
    inspectFrame: async () => (await views()).inspectFrame(rt),
    freezeCut: (frozen) => freezeWebgpuCut(rt, frozen),
    pendingFrame: () => pendingWebgpuFrame(rt),
    measureFrame: () => measureWebgpuFrame(rt),
    skipsFrame: () => skipsWebgpuFrame(rt),
    initialLoad: () => run.initialLoad,
    streamingBlocks: (blocked) => void (run.streamingBlocks = blocked),
    flush(options?: { image?: boolean }) {
      return flushWebgpuPages(rt, options)
    },
    captureSurfaceView(camera, options) {
      return captureSurfaceView(rt, camera, options)
    },
    captureColorView(camera, size) {
      return captureColorView(rt, camera, size)
    },
    async addView(options) {
      const { view, setRenderScale, setTemporalAntialiasing } = await addWebgpuView(rt, options)
      return {
        render: (camera, index) => renderWebgpuView(rt, view, camera, index),
        resize: (width, height, rect) => resizeWebgpuView(view, width, height, rect),
        setRenderScale,
        setTemporalAntialiasing,
        release: () => removeWebgpuView(rt, view),
      }
    },
    capture() {
      return captureImage(rt)
    },
    castRay: (ray, filter, bounds) => castWebgpuRay(rt, ray, filter, bounds),
    selectedPageIds: () => run.shown.map((rec) => rec.url),
    selectedClusterIds: () => run.shown.map((rec) => rec.clusterId),
    rasterView: () => rasterView(rt),
    pendingUrls: () => pendingUrls(rt),
    retainedRanks() {
      return retainedRanks(rt)
    },
    pageSpecs: createArrivalSpecs(rt.setup.byUrl, rt.layout.rows.pageIndexOf),
    acceptPage(url, array, plan) {
      acceptPage(rt, url, array, plan, rt.services.affectsImage)
    },
    hostTableBytes: () => hostTableBytesOf(rt),
    dropPage(url) {
      dropPage(rt, url)
    },
    metrics() {
      return metricsOf(rt)
    },
  } satisfies Partial<Engine>
}

/** The host's CPU steps and the stage profile. */
export function backendTiming(rt: WebgpuPagesRuntime) {
  return {
    resetStageProfile() {
      rt.timing.hostSteps.reset()
      rt.timing.profiler.stages?.reset()
    },
    cpuSteps() {
      return rt.timing.hostSteps.read()
    },
    cpuStep(step, ms) {
      hostCpuStep(rt, step, ms)
    },
    frameCpuMs(ms) {
      rt.timing.logFrame?.(ms, rt.views.main.scale.frameIntervalMs)
    },
    cpuFrameEnd() {
      endCpuFrame(rt)
    },
    stageProfile() {
      return rt.timing.profiler.profile()
    },
  } satisfies Partial<Engine>
}
