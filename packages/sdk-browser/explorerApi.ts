import * as THREE from 'three';
import { DIAGNOSTICS } from '../sdk-core/index.ts';
import type {
  AssetScope,
  CameraPose,
  ClusterManifest,
  FrameMetrics,
  DiagnosticMode,
} from '../sdk-core/index.ts';
import type { BackendContext, ExplorerOptions, RenderBackend } from './backendTypes.ts';
import type { ComparisonLayout } from './comparison.ts';
import type { configureExplorer } from './explorerCapabilities.ts';
import type { EngineProfiler } from './telemetry.ts';
import { createExplorerCameraApi } from './explorerCameraApi.ts';
import { createExplorerDiagnosticApi } from './explorerDiagnosticApi.ts';
import { createExplorerSceneApi } from './explorerSceneApi.ts';
import { createExplorerSelectionApi } from './explorerSelectionApi.ts';
import { createExplorerViewportApi } from './explorerViewportApi.ts';
import { createExplorerTelemetryApi } from './explorerTelemetryApi.ts';
import type { ExplorerApiState } from './explorerState.ts';

type Inputs = {
  options: ExplorerOptions;
  capabilities: Awaited<ReturnType<typeof configureExplorer>>['capabilities'];
  preparationMs: number;
  camera: THREE.PerspectiveCamera;
  center: THREE.Vector3;
  bounds: THREE.Box3;
  metadata: ClusterManifest;
  backends: RenderBackend[];
  canvas: HTMLCanvasElement;
  render: (pose?: CameraPose) => FrameMetrics;
  capture: () => Uint8Array;
  dispose: () => void;
  setPose: (pose: CameraPose) => void;
  awaitPages: () => Promise<void>;
  flush: () => Promise<void>;
  check: () => void;
  scope: AssetScope;
  directGpu: boolean;
  renderer: THREE.WebGLRenderer;
  viewport: [number, number];
  context: BackendContext;
  homeOffset: THREE.Vector3;
  lookAtTarget: THREE.Vector3;
  radius: number;
  hostedControls: { dispose(): void }[];
  beautyMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  overlays: THREE.Material[];
  profiler: EngineProfiler;
  state: () => ExplorerApiState;
  setActive: (backend: RenderBackend) => void;
  setDiagnostic: (mode: DiagnosticMode) => void;
  setCapturingSurface: (value: boolean) => void;
  setMeasuring: (value: boolean) => void;
  setComparison: (
    layout: ComparisonLayout,
    pair?: [string, string],
    wipe?: number,
    toggle?: 0 | 1,
  ) => void;
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
      return state().fallbackReason;
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
      active: () => state().active,
      backends,
      render,
      flush,
      capture,
      scope,
      canvas,
    }),
    ...createExplorerViewportApi({
      check,
      active: () => state().active,
      setCapturingSurface,
      targets: () => ({
        measurement: state().measurementTarget,
        left: state().pairTargetA,
        right: state().pairTargetB,
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
      diagnostic: () => state().diagnostic,
      selectBackend: setActive,
      setComparison,
      directGpu,
      context,
    }),
    get comparison() {
      const { comparisonLayout, comparisonPair, wipe, toggle } = state();
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
      disposed: () => state().disposed,
      setMeasuring,
      setActive,
      hostedControls,
    }),
    get backend() {
      return state().active.id;
    },
    get diagnostic() {
      return state().diagnostic;
    },
    diagnostics: DIAGNOSTICS,
    ...createExplorerDiagnosticApi({
      check,
      active: () => state().active,
      backends,
      beautyMaterials,
      overlays,
      setMode: setDiagnostic,
    }),
    ...createExplorerTelemetryApi(profiler),
  };
}
