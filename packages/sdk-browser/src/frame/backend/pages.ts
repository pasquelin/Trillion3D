import { WEBGPU_ENGINE_ID, type EngineFactory } from '../../session/engine/factory.ts'
import { createWebgpuPagesRuntime } from './runtime.ts'
import { renderWebgpuPages } from '../render/render.ts'
import { refreshFogVolumes, refreshSceneLights, refreshSimpleLights } from '../io/hostApi.ts'
import { webgpuAudits } from '../io/audits.ts'
import { dropTaaHistory } from '../../post/taa/landing.ts'
import { followFrameDifference } from '../render/frameDifference.ts'
import { applySkyToRuntime } from '../render/encodeCloudsSky.ts'
import { reflectionCaptureHosts } from '../render/reflectionCaptureState.ts'
import { renderSkyMeshes, type PersistentViews } from '../render/encodeSkyMeshes.ts'
import { renderCustomDepth } from '../render/encodeCustomDepth.ts'
import { removeWebgpuView, renderWebgpuView, resizeWebgpuView } from './state/persistentView.ts'
import {
  backendHostApi,
  backendSetters,
  backendTiming,
  disposeSession,
  prepareSession,
  type PagesSession,
} from './backendApi.ts'
/** What the sky meshes' capture draws and gives up its faces' views with. */
const persistentViews: PersistentViews = {
  render: renderWebgpuView,
  resize: resizeWebgpuView,
  remove: removeWebgpuView,
}

/** WebGPU raster of cluster pages, cut on the GPU — frustum and per-cluster error band —, its one
 *  cut (#1483). The state lives in the runtime; each method hands it to the module that owns that
 *  responsibility. A caller that keeps the runtime it made hands it as the second argument. */
export const webgpuPagesEngine = ((context, rt = createWebgpuPagesRuntime(context)) => {
  const { run, setup } = rt
  const session: PagesSession = {}
  const backend: ReturnType<EngineFactory> = {
    id: WEBGPU_ENGINE_ID,
    capabilities: rt.capabilities,
    signal: rt.signal,
    get presentedSurface() {
      // The host canvas needs no composition: the engine already presented into it. A lost or
      // disposed device has no presenter left: nothing stale is published (`markWebgpuLost`).
      return context.gpuCanvas ? undefined : rt.gpu.presenter?.canvas
    },
    canvasResized: () => rt.gpu.presenter?.forget(),
    get overBudget() {
      return run.overBudget
    },
    setDiagnostic(mode) {
      run.diagnostic = mode
      // The history accumulated another view: none of it is an image of this one.
      dropTaaHistory(rt.gpu.temporal?.frame)
      followFrameDifference(rt)
      // The diagnostic view changes the table rows and the shading: the scene must be rebuilt.
      run.gate.sceneChanged()
    },
    refreshSceneLights() {
      refreshSceneLights(rt)
    },
    refreshSimpleLights() {
      refreshSimpleLights(rt)
    },
    refreshFogVolumes() {
      refreshFogVolumes(rt)
    },
    // The engine draws the scene aside for a captured sky light (`captureHdrViews`).
    applySky: (sky) => applySkyToRuntime(rt, sky, backend),
    /** The only engine that carries the contract's shadow atlas: everything else is read in its methods. */
    lighting: { shadows: true },
    ...backendSetters(rt),
    prepare: () => prepareSession(rt, context, session),
    render(camera) {
      // The sky meshes the real-time sky capture shows in the place of the atmosphere, drawn aside before the main image.
      renderSkyMeshes(rt, camera, persistentViews)
      // The custom depth of the objects that ask for it, drawn aside likewise.
      renderCustomDepth(rt, camera, persistentViews)
      renderWebgpuPages(rt, camera)
    },
    ...backendHostApi(rt),
    ...backendTiming(rt),
    ...webgpuAudits(rt),
    dispose: () => disposeSession(rt, session),
  }
  // The engine draws the scene aside for the reflection captures too (`captureHdrViews`).
  reflectionCaptureHosts.set(rt, backend)
  return backend
}) satisfies EngineFactory
