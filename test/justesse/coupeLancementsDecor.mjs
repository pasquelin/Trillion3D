// Le décor de la mesure des lancements : la scène mesurée, la médiane, et le compte de commandes
// qu'un encodage ouvre. Séparé de la page pour que chacun des deux tienne sa responsabilité.
import * as THREE from 'three';
import { packDagSelection } from '../../packages/sdk-browser/gpuDagPack.ts';
import {
  dagRecords,
  residentBase,
  residentWords,
} from '../../packages/sdk-browser/gpuDagLayout.ts';
import { scenePages, sceneRoots } from '../../packages/sdk-browser/gpuDagCutFrontierScene.ts';

/** La scène : une pyramide de niveaux, une pose, toutes les pages résidentes, vue de face. La
 *  hiérarchie est celle du compilateur, un nœud par étage de détail sous la racine. */
export function scene(feuilles, niveaux) {
  const roots = sceneRoots(scenePages(feuilles, niveaux), [new THREE.Matrix4()], true);
  const packed = packDagSelection(roots);
  const debut = residentBase(packed.pageCount);
  dagRecords(packed).coldInts.fill(0xffffffff, debut, debut + residentWords(packed.pageCount));
  return { packed, roots };
}

export const mediane = (valeurs) => [...valeurs].sort((a, b) => a - b)[valeurs.length >> 1];

/**
 * Les commandes qu'un encodage ouvre vraiment, comptées sur un encodeur qui ne fait que noter.
 * Publiées, jamais asserties ici : le contrat du nombre de commandes est tenu par
 * `gpuDagEncode.test.ts`, qui compte le même encodeur sans monter d'appareil.
 */
const RIEN = () => {};
export function commandes(encode) {
  let passes = 0,
    copies = 0;
  const passe = { setBindGroup: RIEN, setPipeline: RIEN, end: RIEN };
  passe.dispatchWorkgroups = passe.dispatchWorkgroupsIndirect = RIEN;
  encode({ beginComputePass: () => (passes++, passe), copyBufferToBuffer: () => copies++ });
  return { passes, copies };
}
