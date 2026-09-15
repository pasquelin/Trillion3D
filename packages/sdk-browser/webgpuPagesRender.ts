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
    { selectionRoots, worldUpdates, rows } = rt.layout;
  if (capture.secondaryCamera && !capture.surfaceRenderAllowed)
    throw new Error('SURFACE_CAPTURE_BUSY');
  if (context.signal?.aborted) context.signal.throwIfAborted();
  if (run.lost) throw new Error('WEBGPU_LOST');
  if (!gpuDevice || !gpu.cache) throw new Error('WEBGPU_UNAVAILABLE');
  const marks = rt.timing.marks;
  marks.preStart = performance.now();
  source.updateMatrixWorld(true);
  setWindingEpoch(rows.tableEpoch);
  void rt.texturePump
    .pump()
    .catch((error) => diag.diagnosticFailure('progressive-texture-mips-failed', error));
  for (let i = 0; i < selectionRoots.length; i++)
    worldUpdates.set(selectionRoots[i].world.elements, i * 16);
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
  marks.blendStart = performance.now();
  for (const item of blendState.blendGpu)
    if (item.sourceMesh) {
      item.matrix.copy(item.sourceMesh.matrixWorld);
      if (item.bounds && item.sourceGeometry.boundingBox)
        item.bounds.copy(item.sourceGeometry.boundingBox).applyMatrix4(item.matrix);
    }
  const cpuStart = performance.now();
  // Plus aucune lumière de scène n'est empaquetée par image : les lampes déclarées vivent dans un
  // magasin que l'encodage ne repousse au GPU que si sa révision a bougé (P6). L'étape CPU
  // « Lumières » vaut donc zéro parce que le travail a disparu, pas parce qu'il n'est pas mesuré.
  const lightsEnd = cpuStart;
  run.lastCamera = camera;
  run.overBudget = false;
  run.submittedTriangles = 0;
  run.blendPagedTriangles = 0;
  run.blendUnpagedTriangles = 0;
  run.blendSubmittedTriangles = 0;
  run.blendDrawCalls = 0;
  run.frame++;
  const pixelError = resolvePixelError(context, camera, run.motion);
  run.diagnosticPixelError = pixelError;
  run.gpuFrameActive = false;
  run.gpuMetricsReady = false;
  if (run.gpuSelection?.failed()) dropGpuSelection(rt);
  if (!capture.secondaryCamera && run.gpuSelection?.residentCut && vis.gpuDraw && vis.visEnabled) {
    if (!renderGpuCut(rt, camera, pixelError, cpuStart, lightsEnd)) renderWebgpuPages(rt, camera);
  } else renderCpuCut(rt, camera, pixelError, cpuStart, lightsEnd);
}
