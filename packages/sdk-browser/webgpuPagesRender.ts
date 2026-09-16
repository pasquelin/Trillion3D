import * as THREE from 'three';
import { sameHizView } from './hiz.ts';
import { holdCameraWorld } from './cameraWorld.ts';
import {
  fallbackToCpuCut,
  invalidateOccluderHistory,
  invalidateTemporalPyramid,
} from './webgpuPagesDrops.ts';
import { renderGpuCut } from './webgpuPagesGpuCut.ts';
import { renderCpuCut } from './webgpuPagesRenderCpu.ts';
import { setWindingEpoch } from './webgpuPagesWinding.ts';
import { holdWebgpuFrame } from './webgpuFrameHold.ts';
import { refreshBlendWorlds } from './webgpuBlendWorlds.ts';
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
  run.lastCamera = camera;
  // Entrée d'image : l'ordre et ses garanties vivent dans `frameGateCore.ts`. La liste des nœuds que
  // l'hôte peut écrire n'est construite qu'à un changement de scène, jamais par image — douze
  // instances d'un même modèle relisent ce modèle une fois.
  run.gate.enterFrame(context, camera, run.motion, rt.setup.viewport, source, () => [
    ...selectionRoots.map((root) => root.pages[0]),
    ...blendState.blendGpu,
  ]);
  const pixelError = run.gate.pixelError;
  // Ni la scène, ni la vue, ni les ressources n'ont bougé, et rien n'est en vol : l'image précédente
  // est celle-ci. Aucune étape processeur n'est exécutée en dessous.
  if (holdWebgpuFrame(rt, gpuDevice)) return;
  run.diagnosticPixelError = pixelError;
  // Rien n'est tenu par défaut : seule l'adoption d'un relevé déjà lu le déclare, et tout chemin
  // qui n'y passe pas — coupe processeur, capture de surface, image en attente — refait tout.
  run.cutHeld = false;
  setWindingEpoch(rows.tableEpoch);
  void rt.texturePump
    .pump()
    .catch((error) => diag.diagnosticFailure('progressive-texture-mips-failed', error));
  // Une matrice monde est fonction de la seule scène : une image que rien n'a touchée les
  // retrouverait toutes à l'identique. Elles ne sont donc remontées qu'à un changement de révision
  // de scène, et `setWebgpuTransform` n'y remonte déjà que le sous-arbre qu'il a déplacé.
  run.gate.updateWorlds(source);
  const worldsMoved = run.worldUploadRevision !== run.gate.revisions.scene;
  if (worldsMoved) {
    run.worldUploadRevision = run.gate.revisions.scene;
    for (let i = 0; i < selectionRoots.length; i++)
      worldUpdates.set(selectionRoots[i].world.elements, i * 16);
    // A moved root invalidates every row's world matrix, which is the only shared input to a row the
    // scene can still change after `prepare()`.
    if (run.gpuSelection?.updateWorlds(worldUpdates)) {
      rows.tableEpoch++;
      invalidateOccluderHistory(run);
    }
  }
  if (!sameHizView(run.previousHizView, camera)) {
    // Une caméra qui bouge périme la pyramide temporelle, pas la moitié occulteuse : celle-ci nomme
    // des pages, elle ne choisit que la passe où un cluster est dessiné, et la pyramide de cette
    // image-ci reste seule juge de ce qui est retiré. La garder évite de projeter toutes les boîtes
    // et de les reclasser à chaque image de déplacement.
    invalidateTemporalPyramid(run);
    // La pose monde est recopiée dans la caméra déjà gardée : même comparaison, sans clone par image.
    run.previousHizView = holdCameraWorld(
      run.previousHizView ?? new THREE.PerspectiveCamera(),
      camera,
    );
  }
  marks.blendStart = performance.now();
  // Un item transparent LIT la matrice monde de son maillage source : rien n'est à recopier. Seule
  // sa boîte monde, qui est un calcul, se refait — et seulement quand la scène a changé de matrices.
  if (worldsMoved) refreshBlendWorlds(blendState.blendGpu);
  const cpuStart = performance.now();
  // Plus aucune lumière de scène n'est empaquetée par image : les lampes déclarées vivent dans un
  // magasin que l'encodage ne repousse au GPU que si sa révision a bougé (P6). L'étape CPU
  // « Lumières » vaut donc zéro parce que le travail a disparu, pas parce qu'il n'est pas mesuré.
  const lightsEnd = cpuStart;
  run.overBudget = false;
  run.submittedTriangles = 0;
  run.blendPagedTriangles = 0;
  run.blendUnpagedTriangles = 0;
  run.blendSubmittedTriangles = 0;
  run.blendDrawCalls = 0;
  run.frame++;
  run.gpuFrameActive = false;
  run.gpuMetricsReady = false;
  if (run.gpuSelection?.failed()) fallbackToCpuCut(rt, 'relevé de sélection en échec');
  if (!capture.secondaryCamera && run.gpuSelection?.residentCut && vis.gpuDraw && vis.visEnabled) {
    if (!renderGpuCut(rt, camera, pixelError, cpuStart, lightsEnd)) renderWebgpuPages(rt, camera);
  } else renderCpuCut(rt, camera, pixelError, cpuStart, lightsEnd);
}
