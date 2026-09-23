// Set dressing of the dispatch measurement: the measured scene, the median, and the command
// count an encode opens. Split from the page so each of the two keeps its responsibility.
import * as THREE from 'three';
import { packDagSelection } from '../../../packages/sdk-browser/src/gpu/dag/pack.ts';
import {
  dagRecords,
  residentBase,
  residentWords,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts';

/** The scene: a pyramid of levels, one pose, every page resident, front view. The hierarchy is
 *  the compiler's, one node per detail tier under the root. */
export function scene(feuilles: number, niveaux: number) {
  const roots = sceneRoots(scenePages(feuilles, niveaux), [new THREE.Matrix4()], true);
  const packed = packDagSelection(roots);
  const debut = residentBase(packed.pageCount);
  dagRecords(packed).coldInts.fill(0xffffffff, debut, debut + residentWords(packed.pageCount));
  return { packed, roots };
}

export const mediane = (valeurs: number[]): number =>
  [...valeurs].sort((a, b) => a - b)[valeurs.length >> 1];

/**
 * Commands an encode actually opens, counted on an encoder that only notes them.
 * Published, never asserted here: the command-count contract is held by
 * `packages/sdk-browser/src/gpu/dag/encode.test.ts`, which counts the same encoder without mounting a device.
 */
const RIEN = () => {};
export function commandes(encode: (encoder: GPUCommandEncoder) => void): {
  passes: number;
  copies: number;
} {
  let passes = 0,
    copies = 0;
  const passe = {
    setBindGroup: RIEN,
    setPipeline: RIEN,
    end: RIEN,
    dispatchWorkgroups: RIEN,
    dispatchWorkgroupsIndirect: RIEN,
  };
  // A minimal counting double: `encodeDagKernels`/`encodeAvant` only ever call the methods
  // named here, never mount a real device — the full `GPUCommandEncoder` surface is unneeded.
  const encoder = {
    beginComputePass: () => (passes++, passe),
    copyBufferToBuffer: () => copies++,
  } as unknown as GPUCommandEncoder;
  encode(encoder);
  return { passes, copies };
}
