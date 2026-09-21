import * as THREE from 'three';
import type { CameraPose, DiagnosticMode } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import { createComparisonCompositor, type ComparisonLayout } from './comparison.ts';
import { createBackendPresenter } from './explorerComposeSurface.ts';
import type { prepareExplorer } from './explorerPrepare.ts';
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
  pairTargetA?: THREE.WebGLRenderTarget;
  pairTargetB?: THREE.WebGLRenderTarget;
  measurementTarget?: THREE.WebGLRenderTarget;
  loaded: number;
  pageBytesRead: number;
};

/**
 * The draw adapter of the composition host, mounted on the engine's surface: the one place that
 * still builds a `WebGLRenderer`, for the compositor, the held frame, the render targets and the
 * scenes the witness engines hand over. It reads the size the surface already set and leaves with
 * the composition host (#85).
 */
function createHostDrawAdapter(surface: WebglSurface) {
  const renderer = new THREE.WebGLRenderer({ canvas: surface.canvas, context: surface.context });
  const { width, height, pixelRatio } = surface.size;
  renderer.setDrawingBufferSize(width, height, pixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  return renderer;
}

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
  const renderer = webglSurface && createHostDrawAdapter(webglSurface);
  const compositor = renderer && createComparisonCompositor(renderer);
  // Same owner as the compositor: what puts an engine's image on the host surface, for the frame
  // and for the explicit capture alike.
  const presentBackend = renderer ? createBackendPresenter(renderer) : () => false;
  const targetOptions = { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace };
  const ensureTarget = (current?: THREE.WebGLRenderTarget) =>
    current ?? new THREE.WebGLRenderTarget(canvas.width, canvas.height, targetOptions);
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
    renderer,
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
