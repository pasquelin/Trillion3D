import { disabledStageProfile } from '../../../../sdk-core/src/index.ts'
import { WEBGPU_ENGINE_ID } from '../../engine/factory.ts'
import type { Engine, EngineContext } from '../../engine/types.ts'
import type { WebgpuPagesRuntime } from './runtime.ts'
import { prepareWebgpuBackend } from './prepare/prepare.ts'
import { setWebgpuBounce } from './prepare/bounce.ts'
import { setWebgpuTemporalAntialiasing } from '../../taa/prepare.ts'
import { flushWebgpuPages } from './render/flush.ts'
import { captureSurfaceView } from './io/surfaceCapture.ts'
import { captureColorView } from './io/colorCapture.ts'
import { addWebgpuView, removeWebgpuView, renderWebgpuView } from './state/persistentView.ts'
import {
  captureImage,
  pageUrls,
  pendingUrls,
  rasterView,
  retainedRanks,
  syncResident,
} from './io/hostApi.ts'
import { acceptPage, dropPage } from './io/pageApi.ts'
import { createArrivalSpecs } from '../../page/integration/arrivalSpecs.ts'
import { endCpuFrame, hostCpuStep } from './render/cpuSteps.ts'
import { setWebgpuTransform, setWebgpuTransforms } from './render/transform.ts'
import { webgpuPlacementApi } from '../../placement/webgpuGrowth.ts'
import { composeWebgpuPlacements } from '../../placement/gpuCompose.ts'
import { webgpuVertexApi } from './dynamicVertices.ts'
import { disposeWebgpuPages, metricsOf } from './io/metrics.ts'
import { hostTableBytesOf, setWebgpuMemoryBudgets } from './io/memory.ts'
import { runtimeMaterialApi } from './io/runtimeMaterialApi.ts'
import { setWebgpuClearColor } from './io/clearColor.ts'
import * as materials from './io/refreshMaterials.ts'
import { installGpuDeviceLedger, gpuDeviceLedgerOf } from '../../gpu/core/deviceLedger.ts'
import { namesNoSession } from '../../gpu/core/sessionHandle.ts'
import { families } from '../../host/families.ts'
import { claimWebgpuDevice, markWebgpuLost } from './io/lost.ts'
import type { GpuDeviceClaim } from '../../gpu/core/deviceOwners.ts'
import {
  measureWebgpuFrame,
  pendingWebgpuFrame,
  webgpuLandings,
} from '../frame/interactiveFrame.ts'

const views = () => families.diagnostics.load()

/** The device this session holds until disposed, and its teardown once begun; `setup.preparing`
 *  is the running preparation. */
export type PagesSession = { claim?: GpuDeviceClaim; closing?: Promise<void> }

/** The engine's scene writes: transforms, bounce, antialiasing, scale, placements, vertices,
 *  materials, budgets, clear colour. */
export function backendSetters(rt: WebgpuPagesRuntime) {
  const { run } = rt
  return {
    setTransform: (nodeName, matrix) => setWebgpuTransform(rt, nodeName, matrix),
    setTransforms: (nodes, matrices) => setWebgpuTransforms(rt, nodes, matrices),
    setBounce: (on) => setWebgpuBounce(rt, on),
    setTemporalAntialiasing: (on) => setWebgpuTemporalAntialiasing(rt, on),
    setRenderScale: (scale) => void (rt.scale.set(scale), rt.run.gate.resourcesChanged()),
    renderScale: () => rt.scale.drawn,
    ...webgpuPlacementApi(rt),
    composePlacements: (parent, world, links, whole) =>
      composeWebgpuPlacements(rt, parent, world, links, whole),
    worldCut: () => (run.gpuSelection?.packsWorld ? run.selectionUniforms : undefined),
    ...webgpuVertexApi(rt),
    refreshMaterials: (values, alpha) => materials.refreshWebgpuMaterials(rt, values, alpha),
    materialClassRefusal: (alpha) => materials.webgpuMaterialClassRefusal(alpha, rt.setup.allPages),
    wearSurface: (assignment) => materials.wearWebgpuSurface(rt, assignment),
    setMemoryBudgets: (budgets) => setWebgpuMemoryBudgets(rt, budgets),
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

/** Inert and read as lost at once; torn down once, after the preparation stopped. */
export function disposeSession(rt: WebgpuPagesRuntime, session: PagesSession) {
  const { setup } = rt
  rt.closer.abort()
  gpuDeviceLedgerOf(session.claim?.device)?.releaseAdmission()
  session.claim?.release()
  markWebgpuLost(rt)
  return (session.closing ??= setup.preparing
    ? setup.preparing.then(() => disposeWebgpuPages(rt))
    : disposeWebgpuPages(rt))
}

/** What the host reads and asks of the engine: frames, captures, views, pages, metrics. */
export function backendHostApi(rt: WebgpuPagesRuntime) {
  const { run } = rt
  return {
    syncResident: () => syncResident(rt),
    // The feedback A/B measurements, diagnostic views on demand (`../../host/families.ts`).
    setFeedbackTargetAb: async (target) => (await views()).setFeedbackTargetAb(rt, target),
    feedbackAbResidency: async () => (await views()).feedbackAbResidency(rt),
    captureFeedbackAb: async () => (await views()).captureFeedbackAb(rt),
    feedbackAbSpatial: async () => (await views()).feedbackAbSpatial(rt),
    pendingFrame: () => pendingWebgpuFrame(rt),
    measureFrame: () => measureWebgpuFrame(rt),
    landings: () => webgpuLandings(rt),
    flush(options?: { image?: boolean }) {
      return flushWebgpuPages(rt, options)
    },
    captureSurfaceView(camera, options) {
      return captureSurfaceView(rt, camera, options)
    },
    captureColorView(camera, size) {
      return captureColorView(rt, camera, size)
    },
    async addView(rect) {
      const view = await addWebgpuView(rt, rect)
      return {
        render: (camera) => renderWebgpuView(rt, view, camera),
        release: () => removeWebgpuView(rt, view),
      }
    },
    capture() {
      return captureImage(rt)
    },
    selectedPageIds: () => run.shown.map((rec) => rec.url),
    selectedClusterIds: () => run.shown.map((rec) => rec.clusterId),
    rasterView: () => rasterView(rt),
    pendingUrls: () => pendingUrls(rt),
    pageUrls: () => pageUrls(rt),
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
      rt.timing.stages?.reset()
      rt.timing.cpuWindow.reset()
    },
    cpuSteps() {
      return rt.timing.cpuWindow.summary()
    },
    cpuStep(step, ms) {
      hostCpuStep(rt, step, ms)
    },
    frameCpuMs(ms) {
      rt.timing.logFrame?.(ms, rt.scale.frameIntervalMs)
    },
    cpuFrameEnd() {
      endCpuFrame(rt)
    },
    stageProfile() {
      return (
        rt.timing.stages?.profile() ??
        disabledStageProfile(WEBGPU_ENGINE_ID, 'per-step profile not requested by the host')
      )
    },
  } satisfies Partial<Engine>
}
