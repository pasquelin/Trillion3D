import { DIAGNOSTICS } from '../../../../sdk-core/src/index.ts'
import type { ExplorerProbe } from '../session/capabilityProbe.ts'
import type { ExplorerSource } from '../session/prepare.ts'
import type { SessionRuntime } from '../render/sessionRuntime.ts'
import { createExplorerCameraApi } from './cameraApi.ts'
import { createExplorerDiagnosticApi } from './diagnosticApi.ts'
import { createExplorerSceneApi } from './sceneApi.ts'
import { createExplorerRenderApi } from './renderApi.ts'
import { createExplorerSelectionApi } from './selectionApi.ts'
import { createExplorerViewportApi } from './viewportApi.ts'
import { createExplorerTelemetryApi } from './telemetryApi.ts'
import { createExplorerLightApi } from './lightApi.ts'
import { createExplorerMaterialApi } from './materialApi.ts'

type Inputs = SessionRuntime & {
  capabilities: ExplorerProbe['capabilities']
  preparationMs: number
  moveNamed?: ExplorerSource['moveNamed']
}

/** The engine's own surfaces of the session: its scene changes, its switches, its views, its
 *  lights and materials, its profile. */
function engineApis(inputs: Inputs, onDispose: (release: () => void) => void) {
  const { check, engine, render, flush, capture, scope, canvas, camera, context } = inputs
  return {
    ...createExplorerSceneApi({ check, engine, render, flush, capture, scope, canvas }),
    ...createExplorerRenderApi({ check, engine }),
    ...createExplorerViewportApi({
      ...{ check, engine, camera, canvas, viewport: inputs.viewport, options: inputs.options },
      setCapturingSurface: inputs.setCapturingSurface,
    }),
    ...createExplorerSelectionApi({ check, context }),
    ...createExplorerDiagnosticApi({ check, engine, setMode: inputs.setDiagnostic }),
    ...createExplorerLightApi({
      ...{ check, engine, moveNamed: inputs.moveNamed },
      store: context.sceneLights,
      imported: context.importedLightIds ?? [],
    }),
    ...createExplorerMaterialApi({
      ...{ check, engine, onDispose },
      source: context.source,
      associations: context.associations,
    }),
    ...createExplorerTelemetryApi(inputs.profiler, engine),
  }
}

export function createExplorerApi(inputs: Inputs) {
  const { options, camera, center, radius, canvas, check, state, ownedControls } = inputs
  const materialReleases: (() => void)[] = []
  return {
    ...{ capabilities: inputs.capabilities, preparationMs: inputs.preparationMs },
    ...{ camera, center, bounds: inputs.bounds, metadata: inputs.metadata, canvas },
    /** The session's one engine, the WebGPU page raster. */
    engine: inputs.engine,
    render: inputs.render,
    /** The families the next frame draws with still on their way (`../session/familyUse.ts`). */
    familiesPending: inputs.familiesPending,
    capture: inputs.capture,
    /** The composed image at a size of its own, drawn offscreen, bottom row first. */
    captureView: inputs.captureView,
    /** The WebGPU device the session draws on: a world reopening keeps it. */
    gpuDevice: inputs.gpuDevice,
    dispose() {
      materialReleases.splice(0).forEach((release) => release())
      inputs.dispose()
    },
    ...{ setPose: inputs.setPose, awaitPages: inputs.awaitPages, flush: inputs.flush },
    ...engineApis(inputs, (release) => materialReleases.push(release)),
    ...createExplorerCameraApi({ check, options, camera, center, radius, canvas, ownedControls }),
    get diagnostic() {
      return state.diagnostic
    },
    diagnostics: DIAGNOSTICS,
  }
}
