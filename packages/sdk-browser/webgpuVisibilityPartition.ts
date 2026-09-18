import { visLayerTop } from './webgpuVisibilityUniforms.ts';
import { taaRenderMatrix } from './taaFrame.ts';
import type { PartitionFrame } from './gpuPartitionUniform.ts';
import type { EngineCamera } from './cameraWorld.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const noLevels: Array<{ offset: number; width: number }> = [];
const noMatrix = new Float64Array(16);

/**
 * L'entrée de la partition, remplie à chaque image dans le MÊME objet : `encode` l'écrit dans
 * l'uniforme et recopie dans ses propres tableaux ce que l'audit garde, si bien que rien ici n'a
 * besoin d'être neuf. L'ancre est un tuple tenu de même, pour que la pose de la caméra n'alloue pas.
 */
const anchor: [number, number, number] = [0, 0, 0];
const frame: PartitionFrame = {
  view: noMatrix,
  viewProj: noMatrix,
  anchor,
  near: 0,
  rows: 0,
  width: 0,
  height: 0,
  levels: noLevels,
  layerTop: 0,
  historyValid: false,
  hasRest: false,
};

/**
 * La partition occulteurs/testés de l'image, encodée pour la carte.
 *
 * Plus rien n'y parcourt les lignes résidentes sur le processeur : ni la projection des boîtes en
 * rectangles d'écran, ni le partage des deux moitiés, ni la préparation des bornes du test Hi-Z.
 * L'image a déjà téléversé les coins que la table venait de changer — et eux seuls, avant que
 * `uploadDirtyRows` ne referme cette plage (`uploadRowCorners`). Il ne reste ici que l'écriture d'un
 * uniforme et trois lancements de calcul dont le nombre ne dépend que du nombre de lignes. Rien
 * n'est relu : ce que la partition a décidé revient par le relevé périodique.
 *
 * Les matrices viennent de la caméra du MOTEUR, que l'entrée d'image a déjà remplie du contrat de
 * pose (`cameraWorld.ts`) : vue et vue-projection y sont posées une fois pour toute l'image, en
 * double précision, et la partition n'y ajoute aucun calcul de matrice.
 *
 * `twoPass` est une propriété des RESSOURCES, pas de la décision : dès que la pyramide, le pipeline
 * de la moitié testée, la compaction indirecte et la partition existent, l'image encode ses deux
 * passes. La carte peut n'avoir rien mis dans la moitié testée — elle le fait quand l'historique ou
 * la médiane range tout d'un côté —, et la seconde passe dessine alors zéro instance. Le processeur
 * n'a donc jamais à attendre un verdict de la carte pour savoir quoi encoder.
 */
export function encodeWebgpuPartition(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  useIndirect: boolean,
) {
  const { layout, run, vis, gpu, timing } = rt,
    { rows } = layout,
    partition = vis.gpuPartition;
  const twoPass =
    useIndirect && !!partition && !!vis.gpuHiz && !!vis.visHizRestBack && rows.packedCount >= 2;
  const counts = timing.partitionCounts;
  counts.lignes = rows.packedCount;
  if (!partition) return { twoPass: false };
  const start = performance.now();
  // L'historique est tenu PAR LIGNE : il ne décrit plus rien dès que la table change d'âge, parce
  // qu'une ligne peut alors porter une autre page. C'est la seule condition qui s'y ajoute.
  const historyValid = !run.noOccluderHistory && run.occluderHistoryEpoch === rows.tableEpoch;
  frame.view = cam.view;
  // La matrice de rendu, gigue de l'antialiasing temporel comprise : la pyramide que le test
  // d'occultation lit a été rasterisée avec elle, et ses marges sont à l'ulp près.
  frame.viewProj = taaRenderMatrix(rt, cam);
  // L'ancre de la projection : l'œil dans le monde. Les coins n'entrent dans le noyau que par leur
  // écart à elle, ce qui garde la borne d'erreur serrée quelle que soit la taille du modèle.
  anchor[0] = cam.eye[0];
  anchor[1] = cam.eye[1];
  anchor[2] = cam.eye[2];
  frame.near = cam.near;
  frame.rows = rows.packedCount;
  frame.width = gpu.targetSize[0];
  frame.height = gpu.targetSize[1];
  frame.levels = twoPass ? vis.gpuHiz!.levels() : noLevels;
  frame.layerTop = visLayerTop(vis);
  frame.historyValid = historyValid;
  frame.hasRest = twoPass;
  partition.encode(encoder, frame);
  run.noOccluderHistory = false;
  run.occluderHistoryEpoch = rows.tableEpoch;
  // Ce que l'encodage de la partition coûte au processeur : un uniforme et trois lancements, jamais
  // une ligne résidente. La projection et le partage n'ont plus de borne processeur du tout.
  timing.lastPartitionMs = performance.now() - start;
  // Les comptes de l'image sont ceux que la carte a écrits, relus une image sur quinze. Ils
  // décrivent donc une image antérieure, jamais celle-ci, et restent à zéro avant le premier relevé.
  const sample = partition.counts();
  counts.occulteurs = sample ? sample.occluders : 0;
  counts.testees = sample ? sample.tested : 0;
  counts.historiqueOcculteurs = sample ? sample.historyOccluders : 0;
  counts.sansHistorique = sample && sample.fromHistory ? 0 : 1;
  counts.bornesToutes = sample ? sample.inFront : 0;
  counts.imageRelevee = sample ? sample.frame : -1;
  return { twoPass };
}
