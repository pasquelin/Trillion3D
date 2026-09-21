import * as THREE from 'three';
import type { CameraPose, DiagnosticMode } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import { createComparisonCompositor, type ComparisonLayout } from './comparison.ts';
import { createBackendPresenter } from './explorerComposeSurface.ts';
import type { prepareExplorer } from './explorerPrepare.ts';
import { createWebglRenderTarget, type WebglRenderTarget } from './webglRenderTarget.ts';
import type { WebglSurface } from './webglSurface.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;

/** The mutable state of one explorer host; every service reads and writes this same object. */
export type ExplorerHostState = {
  fallbackReason: string | null;
  active: RenderBackend;
  disposed: boolean;
  diagnostic: DiagnosticMode;
  capturingSurface: boolean;
  measuring: boolean;
  hostFrame: number;
  comparisonLayout: ComparisonLayout;
  comparisonPair: [string, string];
  wipe: number;
  toggle: 0 | 1;
  pairTargetA?: WebglRenderTarget;
  pairTargetB?: WebglRenderTarget;
  measurementTarget?: WebglRenderTarget;
  loaded: number;
  pageBytesRead: number;
};

export function createExplorerHostState(
  prepared: Prepared,
  options: ExplorerOptions,
  backends: RenderBackend[],
  canvas: HTMLCanvasElement,
  webglSurface: WebglSurface | undefined,
  signal?: AbortSignal,
) {
  const { camera, center } = prepared;
  const baseline =
    backends.find((backend) => backend.id === 'three-webgl-reference') ?? backends[0];
  const optimized =
    backends.find((backend) => backend.id === 'exact-cluster-pages') ??
    backends.find((backend) => backend.id === 'webgpu-page-raster') ??
    baseline;
  const state: ExplorerHostState = {
    fallbackReason: null,
    active: optimized,
    disposed: false,
    diagnostic: 'beauty',
    capturingSurface: false,
    measuring: false,
    hostFrame: 0,
    comparisonLayout: options.comparisonLayout ?? 'single',
    comparisonPair: options.comparisonPair ?? [
      baseline.id,
      backends.find((backend) => backend.id === 'exact-cluster-pages')?.id ??
        backends[backends.length - 1].id,
    ],
    wipe: 0.5,
    toggle: 0,
    loaded: prepared.pageSources.loaded,
    pageBytesRead: prepared.pageSources.pageBytesRead,
  };
  if (prepared.directGpu && state.comparisonLayout !== 'single')
    throw new Error('SINGLE_BACKEND_COMPARISON');
  const beautyMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const overlays: THREE.Material[] = [];
  const hostedControls: { dispose(): void }[] = [];
  const lookAtTarget = new THREE.Vector3().copy(center);
  // The composition programs live on the engine's context, next to the targets they read: what
  // puts an engine's image on the host surface, for the frame and for the explicit capture alike.
  const gl = webglSurface?.context;
  const compositor = gl && createComparisonCompositor(gl);
  const presentBackend = gl
    ? createBackendPresenter(gl)
    : Object.assign(() => false, { dispose() {} });
  /**
   * A render target of the composition — one side of a comparison, the measurement surface —
   * at the drawing-buffer size, sRGB encoded like the targets the reference allocates. Targets
   * built on a context since lost are forgotten together: their names died with that context,
   * and each is rebuilt when next asked for.
   */
  let targetsContext = webglSurface?.restorations;
  const ensureTarget = (current?: WebglRenderTarget) => {
    if (!gl || !webglSurface) throw new Error('The direct GPU path has no host render target');
    if (webglSurface.restorations !== targetsContext) {
      targetsContext = webglSurface.restorations;
      state.pairTargetA = state.pairTargetB = state.measurementTarget = undefined;
      current = undefined;
    }
    return current ?? createWebglRenderTarget(gl, canvas.width, canvas.height, { srgb: true });
  };
  const check = () => {
    if (state.disposed) throw new Error('Explorer disposed');
    if (state.capturingSurface) throw new Error('SURFACE_CAPTURE_BUSY');
    signal?.throwIfAborted();
  };
  const setPose = (pose: CameraPose) => {
    camera.position.fromArray(pose.position);
    camera.fov = pose.fov;
    camera.near = pose.near;
    camera.far = pose.far;
    camera.lookAt(lookAtTarget.fromArray(pose.target));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  return {
    state,
    baseline,
    webglSurface,
    beautyMaterials,
    overlays,
    hostedControls,
    lookAtTarget,
    compositor,
    presentBackend,
    ensureTarget,
    check,
    setPose,
  };
}
