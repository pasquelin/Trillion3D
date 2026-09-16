import { invertMatrix4 } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { checkSurfaceSize, createSurfaceBuffer, type SurfaceCapture } from './surfaceBuffer.ts';
import { collectPendingUrls } from './pageSelection.ts';
import { viewProj } from './webgpuPagesHelpers.ts';
import { checkFrameBudget } from './webgpuPagesTargets.ts';
import { resetHizHistory } from './webgpuPagesDrops.ts';
import { holdHostCamera, resolveCameraWorld } from './cameraWorld.ts';
import {
  drawResidentCut,
  renderForCapture,
  restoreMainView,
  type SavedView,
} from './webgpuPagesSurfaceRestore.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

type CaptureOptions = { width: number; height: number; signal?: AbortSignal };

/** Copies the surfaces of the secondary view into buffers the host owns until it disposes them. */
function copySurfaces(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  view: THREE.PerspectiveCamera,
  options: CaptureOptions,
  reserve: number,
): SurfaceCapture {
  const { gpu, capture, diag } = rt;
  if (!rt.vis.visEnabled || !gpu.surfaces || !gpu.depthTexture)
    throw new Error('SURFACE_CAPTURE_UNAVAILABLE');
  const owned = createSurfaceBuffer(gpuDevice, options.width, options.height, reserve);
  let depth: GPUTexture;
  try {
    depth = gpuDevice.createTexture({
      label: 'WG owned surface depth',
      size: { width: options.width, height: options.height },
      format: 'depth32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
    });
  } catch (error) {
    owned.dispose();
    throw error;
  }
  let released = false;
  const result: SurfaceCapture = {
    ...owned,
    allocationBytes: reserve,
    depth,
    inverseViewProjection: [...invertMatrix4(new Float64Array(16), viewProj)],
    cameraWorld: view.getWorldPosition(new THREE.Vector3()).toArray() as [number, number, number],
    selectedTriangles: rt.run.selectedTriangles,
    dispose() {
      if (released) return;
      released = true;
      owned.dispose();
      depth.destroy();
      capture.captureAllocationBytes = 0;
      capture.surfaceCapture = undefined;
      diag.engineDiagnostic('surface-capture-released', 'Capture GPU libérée', {
        allocationBytes: reserve,
      });
    },
  };
  const encoder = gpuDevice.createCommandEncoder();
  const from = [
      gpu.surfaces.baseMetal,
      gpu.surfaces.normalRough,
      gpu.surfaces.emissiveAo,
      gpu.surfaces.flags,
      gpu.depthTexture,
    ],
    to = [owned.baseMetal, owned.normalRough, owned.emissiveAo, owned.flags, depth];
  for (let i = 0; i < from.length; i++)
    encoder.copyTextureToTexture({ texture: from[i] }, { texture: to[i] }, [
      options.width,
      options.height,
    ]);
  gpuDevice.queue.submit([encoder.finish()]);
  return result;
}

/** Renders a second camera into owned material surfaces, then restores the main view. */
export async function captureSurfaceView(
  rt: WebgpuPagesRuntime,
  camera: THREE.PerspectiveCamera,
  options: CaptureOptions,
) {
  const { run, capture, context, diag } = rt,
    { gpuDevice, viewport, frameBudget } = rt.setup;
  context.signal?.throwIfAborted();
  options.signal?.throwIfAborted();
  if (capture.secondaryCamera || capture.surfaceCapture)
    throw new Error('SURFACE_CAPTURE_BUSY: dispose the previous capture first');
  if (run.lost || !gpuDevice || !rt.vis.visEnabled || !run.lastCamera)
    throw new Error('SURFACE_CAPTURE_UNAVAILABLE');
  const reserve = checkSurfaceSize(gpuDevice, options.width, options.height, frameBudget, 32);
  checkFrameBudget(rt, viewport[0], viewport[1], reserve);
  checkFrameBudget(rt, options.width, options.height, reserve);
  const saved: SavedView = {
    main: run.lastCamera,
    size: [viewport[0], viewport[1]],
    diagnostic: run.diagnostic,
    motion: { ...run.motion },
  };
  // Entrée de capture : la caméra vient de l'hôte comme celle d'une image. La copie détachée garde
  // la pose monde ; un clone la ramènerait à sa pose locale sous un rig.
  resolveCameraWorld(camera);
  const view = holdHostCamera(new THREE.PerspectiveCamera(), camera);
  view.aspect = options.width / options.height;
  view.updateProjectionMatrix();
  view.updateMatrixWorld();
  const started = performance.now();
  const throwIfAborted = () => {
    options.signal?.throwIfAborted();
    context.signal?.throwIfAborted();
  };
  let result: SurfaceCapture | undefined;
  capture.secondaryCamera = view;
  capture.captureAllocationBytes = reserve;
  diag.engineDiagnostic('surface-capture-start', 'Capture GPU depuis une seconde caméra', {
    width: options.width,
    height: options.height,
    allocationBytes: reserve,
  });
  let captureError: { error: unknown } | undefined;
  try {
    await rt.services.residency.pending;
    await gpuDevice.queue.onSubmittedWorkDone();
    throwIfAborted();
    viewport[0] = options.width;
    viewport[1] = options.height;
    run.diagnostic = 'beauty';
    resetHizHistory(run);
    run.motion.last = undefined;
    run.motion.lastMs = undefined;
    renderForCapture(rt, view);
    await drawResidentCut(rt, gpuDevice, view, {
      admitted: () => {
        const missing = collectPendingUrls(run.desired, []);
        if (missing.length) throw new Error(`SURFACE_PAGES_NOT_RESIDENT: ${missing.length}`);
        if (run.coverageBudgetLimited) throw new Error('SURFACE_PAGE_BUDGET');
      },
      beforeEncode: throwIfAborted,
    });
    result = copySurfaces(rt, gpuDevice, view, options, reserve);
    await gpuDevice.queue.onSubmittedWorkDone();
    throwIfAborted();
    if (run.lost) throw new Error('WEBGPU_LOST');
    capture.surfaceCapture = result;
    diag.engineDiagnostic('surface-capture-ready', 'Surface GPU disponible', {
      surfaceVersion: 1,
      width: options.width,
      height: options.height,
      selectedTriangles: run.selectedTriangles,
      allocationBytes: reserve,
      durationMs: performance.now() - started,
      imageReadback: false,
    });
  } catch (error) {
    result?.dispose();
    capture.captureAllocationBytes = 0;
    diag.diagnosticFailure('surface-capture-failed', error);
    captureError = { error };
  }
  let restoreError: { error: unknown } | undefined;
  try {
    await restoreMainView(rt, gpuDevice, saved);
  } catch (error) {
    result?.dispose();
    diag.diagnosticFailure('surface-restore-failed', error);
    restoreError = { error };
  }
  if (restoreError && captureError)
    throw new AggregateError(
      [captureError.error, restoreError.error],
      'Surface capture and main view restoration failed',
    );
  if (restoreError) throw restoreError.error;
  if (captureError) throw captureError.error;
  return result!;
}
