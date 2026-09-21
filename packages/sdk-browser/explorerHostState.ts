import * as THREE from 'three';
import type { CameraPose, DiagnosticMode } from '../sdk-core/index.ts';
import type { ExplorerOptions, RenderBackend } from './backendTypes.ts';
import { createComparisonCompositor, type ComparisonLayout } from './comparison.ts';
import { createFrameComposer } from './explorerCompose.ts';
import type { prepareExplorer } from './explorerPrepare.ts';
import { boundToContext } from './webglContextBound.ts';
import { createWebglRenderTarget, type WebglRenderTarget } from './webglRenderTarget.ts';
import type { WebglSurface } from './webglSurface.ts';

type Prepared = Awaited<ReturnType<typeof prepareExplorer>>;
/** A composition target that outlives a context loss: `current()` is the live one. */
export type BoundTarget = ReturnType<typeof boundToContext<WebglRenderTarget>>;

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
  pairTargetA?: BoundTarget;
  pairTargetB?: BoundTarget;
  measurementTarget?: BoundTarget;
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
  // The composition lives on the engine's context: the composer, which puts an engine's image
  // on the surface or a target for the frame and the explicit capture alike, and the comparison
  // compositor. The direct GPU path composes nothing.
  const gl = webglSurface?.context;
  const composition = gl
    ? { compose: createFrameComposer(gl, camera), compositor: createComparisonCompositor(gl) }
    : {
        compose: Object.assign(
          () => {
            throw new Error('The direct GPU path has no host composer');
          },
          { dispose() {} },
        ),
        compositor: undefined,
      };
  /** One side of a comparison or the measurement surface, at the drawing-buffer size. */
  const ensureTarget = (current?: BoundTarget) => {
    if (!gl) throw new Error('The direct GPU path has no host render target');
    return (
      current ??
      boundToContext(
        gl,
        () => createWebglRenderTarget(gl, canvas.width, canvas.height),
        (target) => target.dispose(),
      )
    );
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
    ...composition,
    disposeComposition() {
      composition.compose.dispose();
      composition.compositor?.dispose();
    },
    ensureTarget,
    check,
    setPose,
  };
}
