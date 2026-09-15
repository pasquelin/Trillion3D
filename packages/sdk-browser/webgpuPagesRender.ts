import * as THREE from 'three';
import { resolvePixelError } from './pageSelection.ts';
import { sameHizView } from './hiz.ts';
import { dropGpuSelection, invalidateOccluderHistory } from './webgpuPagesDrops.ts';
import { renderGpuCut } from './webgpuPagesGpuCut.ts';
import { renderCpuCut } from './webgpuPagesRenderCpu.ts';
import { setWindingEpoch } from './webgpuPagesWinding.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Renders one image: refreshes the scene inputs a row depends on, then hands the frame to the GPU
 *  cut when it is available and to the CPU reference cut otherwise. */
export function renderWebgpuPages(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  const { run, gpu, vis, capture, context, diag, blendState } = rt,
    { gpuDevice, source } = rt.setup,
    { opaqueRoots, worldUpdates, rows } = rt.layout;
  if (capture.secondaryCamera && !capture.surfaceRenderAllowed)
    throw new Error('SURFACE_CAPTURE_BUSY');
  if (context.signal?.aborted) context.signal.throwIfAborted();
  if (run.lost) throw new Error('WEBGPU_LOST');
  if (!gpuDevice || !gpu.cache) throw new Error('WEBGPU_UNAVAILABLE');
  source.updateMatrixWorld(true);
  setWindingEpoch(rows.tableEpoch);
  void rt.texturePump
    .pump()
    .catch((error) => diag.diagnosticFailure('progressive-texture-mips-failed', error));
  for (let i = 0; i < opaqueRoots.length; i++)
    worldUpdates.set(opaqueRoots[i].world.elements, i * 16);
  // A moved root invalidates every row's world matrix, which is the only shared input to a row the
  // scene can still change after `prepare()`.
  if (run.gpuSelection?.updateWorlds(worldUpdates)) {
    rows.tableEpoch++;
    invalidateOccluderHistory(run);
  }
  if (!sameHizView(run.previousHizView, camera)) {
    invalidateOccluderHistory(run);
    // La pose est recopiée dans la caméra déjà gardée : même comparaison, sans clone par image.
    run.previousHizView = (run.previousHizView ?? new THREE.PerspectiveCamera()).copy(
      camera,
      false,
    );
  }
  for (const item of blendState.blendGpu)
    if (item.sourceMesh) {
      item.matrix.copy(item.sourceMesh.matrixWorld);
      if (item.bounds && item.sourceGeometry.boundingBox)
        item.bounds.copy(item.sourceGeometry.boundingBox).applyMatrix4(item.matrix);
    }
  const cpuStart = performance.now();
  run.lightState = gpu.lights?.update();
  const lightsEnd = performance.now();
  run.lastCamera = camera;
  run.overBudget = false;
  run.submittedTriangles = 0;
  run.blendSubmittedTriangles = 0;
  run.blendDrawCalls = 0;
  run.frame++;
  if (diag.traceEnabled)
    diag.traceDiagnostic('cpu-lights', 'Mise à jour CPU des lumières', () => ({
      frame: run.frame,
      scope: 'cpu/lights.update',
      elapsedMs: lightsEnd - cpuStart,
      lightState: run.lightState,
    }));
  const pixelError = resolvePixelError(context, camera, run.motion);
  run.diagnosticPixelError = pixelError;
  run.gpuFrameActive = false;
  run.gpuMetricsReady = false;
  if (run.gpuSelection?.failed()) dropGpuSelection(rt);
  if (!capture.secondaryCamera && run.gpuSelection?.residentCut && vis.gpuDraw && vis.visEnabled) {
    if (!renderGpuCut(rt, camera, pixelError, cpuStart, lightsEnd)) renderWebgpuPages(rt, camera);
  } else renderCpuCut(rt, camera, pixelError, cpuStart, lightsEnd);
}
