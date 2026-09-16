import * as THREE from 'three';
import { boxTransform } from '../sdk-core/index.ts';
import { resolvePixelError } from './pageSelection.ts';
import { readThreeBox } from './threeBounds.ts';
import { sameHizView } from './hiz.ts';
import { holdCameraWorld } from './cameraWorld.ts';
import {
  dropGpuSelection,
  invalidateOccluderHistory,
  invalidateTemporalPyramid,
} from './webgpuPagesDrops.ts';
import { renderGpuCut } from './webgpuPagesGpuCut.ts';
import { renderCpuCut } from './webgpuPagesRenderCpu.ts';
import { setWindingEpoch } from './webgpuPagesWinding.ts';
import { holdWebgpuFrame } from './webgpuFrameHold.ts';
import { bumpScene } from './frameRevisions.ts';
import type { BlendGpuItem } from './webgpuBlendState.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Vrai quand deux matrices portent exactement les mêmes seize nombres. Un `NaN` d'un côté n'est
 *  jamais « le même » : la boîte repart, ce qui est le côté sûr. */
function sameMatrix(held: readonly number[], world: readonly number[]) {
  for (let i = 0; i < 16; i++) if (held[i] !== world[i]) return false;
  return true;
}

/**
 * La matrice d'un item transparent et la boîte monde qu'elle transporte sont fonction de la seule
 * matrice monde de son maillage source. Une matrice que la scène n'a pas bougée rendrait les mêmes
 * seize nombres, donc la même boîte : elle est comparée au lieu d'être recopiée, et les huit coins
 * ne repartent que là où quelque chose a bougé. Rend le nombre d'items qui ont bougé.
 */
export function refreshBlendWorlds(items: readonly BlendGpuItem[]) {
  let moved = 0;
  for (const item of items) {
    const mesh = item.sourceMesh;
    if (!mesh || sameMatrix(item.matrix.elements, mesh.matrixWorld.elements)) continue;
    item.matrix.copy(mesh.matrixWorld);
    if (item.bounds && item.sourceGeometry.boundingBox) {
      readThreeBox(item.bounds, item.sourceGeometry.boundingBox);
      boxTransform(item.bounds, 0, item.bounds, 0, item.matrix.elements);
    }
    moved++;
  }
  return moved;
}

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
  // Une fois pour toute l'image, ancêtres compris : un rig d'hôte n'appartient pas à la scène
  // préparée. Avant tout le reste, car la vitesse du seuil adaptatif, la révision de vue, la coupe,
  // l'encodage, les ombres et les lumières lisent tous cette même pose.
  camera.updateWorldMatrix(true, false);
  // La vitesse de la caméra se lit à chaque image, tenue ou non : la sauter fausserait le seuil
  // adaptatif de la première image qui bouge à nouveau.
  const pixelError = resolvePixelError(context, camera, run.motion);
  run.viewRevision.read(
    run.revisions,
    camera,
    rt.setup.viewport[0],
    rt.setup.viewport[1],
    pixelError,
  );
  // L'hôte a le droit d'écrire le graphe source sans passer par le moteur — la pose d'un nœud, la
  // visibilité, une lampe. Aucune révision ne l'annonce : la relecture est ce qui l'annonce, et elle
  // précède la décision de tenir l'image comme la remontée des matrices, qu'elle a déjà faite.
  if (run.sceneWatch.changed(source)) bumpScene(run.revisions);
  run.worldsRevision = run.revisions.scene;
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
  // Les matrices monde sont déjà remontées par la relecture ci-dessus ; ce qui reste incrémental
  // est leur TÉLÉVERSEMENT, borné par le nombre de racines de sélection et non par les pages.
  const worldsMoved = run.worldUploadRevision !== run.revisions.scene;
  if (worldsMoved) {
    run.worldUploadRevision = run.revisions.scene;
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
  // Les items transparents ne portent que la matrice monde de leur maillage source : la même liste
  // de nœuds modifiés les gouverne, et une scène immobile ne les fait plus visiter.
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
  if (run.gpuSelection?.failed()) dropGpuSelection(rt);
  if (!capture.secondaryCamera && run.gpuSelection?.residentCut && vis.gpuDraw && vis.visEnabled) {
    if (!renderGpuCut(rt, camera, pixelError, cpuStart, lightsEnd)) renderWebgpuPages(rt, camera);
  } else renderCpuCut(rt, camera, pixelError, cpuStart, lightsEnd);
}
