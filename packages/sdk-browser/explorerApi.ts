import { DIAGNOSTICS } from '../sdk-core/index.ts';
import type { configureExplorer } from './explorerCapabilities.ts';
import type { ExplorerRuntimeSurface } from './explorerHostRuntime.ts';
import { createExplorerCameraApi } from './explorerCameraApi.ts';
import { createExplorerDiagnosticApi } from './explorerDiagnosticApi.ts';
import { createExplorerSceneApi } from './explorerSceneApi.ts';
import { createExplorerSelectionApi } from './explorerSelectionApi.ts';
import { createExplorerViewportApi } from './explorerViewportApi.ts';
import { createExplorerTelemetryApi } from './explorerTelemetryApi.ts';

type Inputs = ExplorerRuntimeSurface & {
  capabilities: Awaited<ReturnType<typeof configureExplorer>>['capabilities'];
  preparationMs: number;
};

export function createExplorerApi(inputs: Inputs) {
  const {
    options,
    capabilities,
    preparationMs,
    camera,
    center,
    bounds,
    metadata,
    backends,
    canvas,
    render,
    capture,
    dispose,
    setPose,
    awaitPages,
    flush,
    check,
    scope,
    directGpu,
    renderer,
    viewport,
    context,
    homeOffset,
    lookAtTarget,
    radius,
    hostedControls,
    beautyMaterials,
    overlays,
    profiler,
    state,
    setActive,
    setDiagnostic,
    setCapturingSurface,
    setMeasuring,
    setComparison,
  } = inputs;
  return {
    capabilities,
    get fallbackReason() {
      return state.fallbackReason;
    },
    preparationMs,
    camera,
    center,
    bounds,
    metadata,
    backends,
    canvas,
    render,
    capture,
    dispose,
    setPose,
    awaitPages,
    flush,
    ...createExplorerSceneApi({
      check,
      active: () => state.active,
      backends,
      render,
      flush,
      capture,
      scope,
      canvas,
    }),
    ...createExplorerViewportApi({
      check,
      active: () => state.active,
      setCapturingSurface,
      targets: () => ({
        measurement: state.measurementTarget,
        left: state.pairTargetA,
        right: state.pairTargetB,
      }),
      camera,
      canvas,
      renderer,
      viewport,
      directGpu,
      options,
    }),
    ...createExplorerSelectionApi({
      check,
      backends,
      diagnostic: () => state.diagnostic,
      selectBackend: setActive,
      setComparison,
      directGpu,
      context,
    }),
    get comparison() {
      const { comparisonLayout, comparisonPair, wipe, toggle } = state;
      return { layout: comparisonLayout, pair: comparisonPair, wipe, toggle };
    },
    ...createExplorerCameraApi({
      check,
      options,
      camera,
      center,
      homeOffset,
      lookAtTarget,
      radius,
      canvas,
      renderer,
      backends,
      disposed: () => state.disposed,
      setMeasuring,
      setActive,
      hostedControls,
    }),
    get backend() {
      return state.active.id;
    },
    get diagnostic() {
      return state.diagnostic;
    },
    diagnostics: DIAGNOSTICS,
    ...createExplorerDiagnosticApi({
      check,
      active: () => state.active,
      backends,
      beautyMaterials,
      overlays,
      setMode: setDiagnostic,
    }),
    ...createExplorerTelemetryApi(profiler),
  };
}
