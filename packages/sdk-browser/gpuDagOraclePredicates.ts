import { coneCullsPage } from './pageCone.ts';
import { SELECTION_NONE as NONE } from './gpuSelection.ts';
import type { PackedDag } from './gpuDagTypes.ts';
import {
  bandError,
  bandSphere,
  boxInto,
  coneInto,
  CLUSTER_NEVER,
  type DagRecords,
  flagsOf,
  hasBoxOf,
  ownerOf,
  worldOf,
} from './gpuDagLayout.ts';
import { frustumExcludesBox } from '../sdk-core/index.ts';
import { dagScratch, projectedError } from './gpuDagOracleMath.ts';
import { readCameraWorld } from './cameraWorld.ts';

type PredicateContext = {
  packed: PackedDag;
  /** Le décodeur unique, ouvert une fois par évaluation et partagé avec le reste de l'oracle. */
  records: DagRecords;
  nodeFlags: Uint8Array;
  planes: Float64Array[];
  views: number[][];
  stretches: number[];
  focal: number;
  near: number;
};

export function createDagOraclePredicates(context: PredicateContext) {
  const { packed, records, nodeFlags, planes, views, stretches, focal, near } = context;
  const { worlds } = packed;
  const coneRejects = (index: number, w: number) => {
    if (!hasBoxOf(records, index)) return false;
    const { cone, cam, min, max } = dagScratch;
    coneInto(records, index, cone);
    boxInto(records, index, min, max);
    // Les matrices monde du noyau sont celles du repère de rendu, dont `cameraWorld` des uniformes est
    // l'origine : la caméra y est à zéro. L'oracle pose donc la sienne à zéro — mettre la position
    // monde ici mêlerait un opérande absolu à des boîtes relatives, et le cône trancherait faux.
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld();
    dagScratch.world.fromArray(worlds.subarray(w * 16, w * 16 + 16));
    return coneCullsPage(
      cone,
      dagScratch.world,
      min,
      max,
      readCameraWorld(dagScratch.engineCam, cam),
    );
  };
  const visible = (index: number) => {
    // Le nœud propriétaire vit au froid, hors de ce que chaque passe de l'image relit.
    const node = ownerOf(records, index);
    if (flagsOf(records, index) & CLUSTER_NEVER) return false;
    if (node !== NONE && nodeFlags[node]) return false;
    const { min, max } = dagScratch;
    boxInto(records, index, min, max);
    return !frustumExcludesBox(
      planes[worldOf(records, index)],
      min[0],
      min[1],
      min[2],
      max[0],
      max[1],
      max[2],
    );
  };
  const bandPixels = (index: number, at: number) => {
    const w = worldOf(records, index),
      sphere = bandSphere(records, index, at),
      { hot } = records;
    return projectedError(
      bandError(records, index, at),
      hot[sphere],
      hot[sphere + 1],
      hot[sphere + 2],
      hot[sphere + 3],
      views[w],
      stretches[w],
      focal,
      near,
    );
  };
  const selects = (index: number, threshold: number) =>
    bandPixels(index, 0) <= threshold && bandPixels(index, 1) > threshold;
  return { coneRejects, visible, bandPixels, selects };
}
