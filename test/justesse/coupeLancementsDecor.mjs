// Set dressing of the dispatch measurement: the measured scene, the median, and the command
// count an encode opens. Split from the page so each of the two keeps its responsibility.
import * as THREE from 'three';
import { packDagSelection } from '../../packages/sdk-browser/gpuDagPack.ts';
import {
  dagRecords,
  residentBase,
  residentWords,
} from '../../packages/sdk-browser/gpuDagLayout.ts';
import { scenePages, sceneRoots } from '../../packages/sdk-browser/gpuDagCutFrontierScene.ts';

/** The scene: a pyramid of levels, one pose, every page resident, front view. The hierarchy is
 *  the compiler's, one node per detail tier under the root. */
export function scene(feuilles, niveaux) {
  const roots = sceneRoots(scenePages(feuilles, niveaux), [new THREE.Matrix4()], true);
  const packed = packDagSelection(roots);
  const debut = residentBase(packed.pageCount);
  dagRecords(packed).coldInts.fill(0xffffffff, debut, debut + residentWords(packed.pageCount));
  return { packed, roots };
}

export const mediane = (valeurs) => [...valeurs].sort((a, b) => a - b)[valeurs.length >> 1];

/**
 * Commands an encode actually opens, counted on an encoder that only notes them.
 * Published, never asserted here: the command-count contract is held by
 * `gpuDagEncode.test.ts`, which counts the same encoder without mounting a device.
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
