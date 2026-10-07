import { WEBGPU_ENGINE_ID, type EngineFactory } from '../../engine/factory.ts'
import { createWebgpuPagesRuntime } from './runtime.ts'
import { renderWebgpuPages } from './render/render.ts'
import { refreshSceneLights } from './io/hostApi.ts'
import { webgpuAudits } from './io/audits.ts'
import {
  backendHostApi,
  backendSetters,
  backendTiming,
  disposeSession,
  prepareSession,
  type PagesSession,
} from './backendApi.ts'
/** WebGPU raster of cluster pages, cut on the GPU — frustum and per-cluster error band —, its one
 *  cut (#1483). The state lives in the runtime; each method hands it to the module that owns that
 *  responsibility. */
export const webgpuPagesEngine = ((context) => {
  const rt = createWebgpuPagesRuntime(context)
  const { run, setup } = rt
  const session: PagesSession = {}
  const backend: ReturnType<EngineFactory> = {
    id: WEBGPU_ENGINE_ID,
    capabilities: rt.capabilities,
    signal: rt.signal,
    scene: setup.scene,
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
      // The diagnostic view changes the table rows and the shading: the scene must be rebuilt.
      run.gate.sceneChanged()
    },
    refreshSceneLights() {
      refreshSceneLights(rt)
    },
    /** The only engine that carries the contract's shadow atlas: everything else is read in its methods. */
    lighting: { shadows: true },
    ...backendSetters(rt),
    prepare: () => prepareSession(rt, context, session),
    render(camera) {
      renderWebgpuPages(rt, camera)
    },
    ...backendHostApi(rt),
    ...backendTiming(rt),
    ...webgpuAudits(rt),
    dispose: () => disposeSession(rt, session),
  }
  return backend
}) satisfies EngineFactory
