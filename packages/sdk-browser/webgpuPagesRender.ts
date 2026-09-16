import { resolvePixelError } from './pageSelection.ts';
import { sameHizView } from './hiz.ts';
import {
  createEngineCamera,
  holdCameraWorld,
  readCameraWorld,
  type HostCamera,
} from './cameraWorld.ts';
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
import { refreshBlendWorlds } from './webgpuBlendWorlds.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Renders one image: refreshes the scene inputs a row depends on, then hands the frame to the GPU
 *  cut when it is available and to the CPU reference cut otherwise. */
export function renderWebgpuPages(rt: WebgpuPagesRuntime, camera: HostCamera) {
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
  // Entrée d'image : la pose monde, ancêtres compris, est résolue et recopiée ici une fois — vue,
  // vue-projection, plans du tronc et position —, avant le seuil adaptatif et avant l'empreinte de
  // vue. Tout ce qui suit lit cette structure. Contrat et garanties : `cameraWorld.ts`.
  const cam = readCameraWorld(run.cam, camera);
  // La vitesse de la caméra se lit à chaque image, tenue ou non : la sauter fausserait le seuil
  // adaptatif de la première image qui bouge à nouveau.
  const pixelError = resolvePixelError(context, cam, run.motion);
  run.viewRevision.read(run.revisions, cam, rt.setup.viewport[0], rt.setup.viewport[1], pixelError);
  // L'hôte a le droit d'écrire le graphe source sans passer par le moteur — la pose d'un nœud, la
  // visibilité, une lampe. Aucune révision ne l'annonce : la relecture est ce qui l'annonce, et elle
  // précède la décision de tenir l'image. Elle ne remonte rien : elle compare des poses locales,
  // sur les seuls nœuds source, une liste refaite après chaque changement de scène et jamais par
  // image — douze instances d'un même modèle relisent ce modèle une fois.
  if (run.watchRevision !== run.revisions.scene) {
    run.sceneWatch.observe(source, [
      ...selectionRoots.map((root) => root.pages[0]),
      ...blendState.blendGpu,
    ]);
    run.watchRevision = run.revisions.scene;
  }
  if (run.sceneWatch.changed()) bumpScene(run.revisions);
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
  if (run.worldsRevision !== run.revisions.scene) {
    run.worldsRevision = run.revisions.scene;
    source.updateMatrixWorld(true);
  }
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
  if (!sameHizView(run.previousHizView, cam)) {
    // Une caméra qui bouge périme la pyramide temporelle, pas la moitié occulteuse : celle-ci nomme
    // des pages, elle ne choisit que la passe où un cluster est dessiné, et la pyramide de cette
    // image-ci reste seule juge de ce qui est retiré. La garder évite de projeter toutes les boîtes
    // et de les reclasser à chaque image de déplacement.
    invalidateTemporalPyramid(run);
    // La pose monde est recopiée dans la caméra déjà gardée : même comparaison, sans clone par image.
    run.previousHizView = holdCameraWorld(run.previousHizView ?? createEngineCamera(), cam);
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
  if (run.gpuSelection?.failed()) dropGpuSelection(rt);
  if (!capture.secondaryCamera && run.gpuSelection?.residentCut && vis.gpuDraw && vis.visEnabled) {
    if (!renderGpuCut(rt, cam, pixelError, cpuStart, lightsEnd)) renderWebgpuPages(rt, camera);
  } else renderCpuCut(rt, cam, pixelError, cpuStart, lightsEnd);
}
