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
import { copyMatrix4, frustumExcludesBox } from '../sdk-core/src/index.ts';
import { dagScratch, projectedError } from './gpuDagOracleMath.ts';
import type { MatrixElements } from './matrixElements.ts';

type PredicateContext = {
  packed: PackedDag;
  /** Unique decoder, opened once per evaluation and shared with the rest of the oracle. */
  records: DagRecords;
  nodeFlags: Uint8Array;
  planes: Float64Array[];
  views: number[][];
  stretches: number[];
  focal: number;
  near: number;
  perspective: number;
  /** The camera of the render frame, homogeneous (`DagViewFrames.viewPoint`). */
  viewPoint: Float64Array;
};

/** The scratch world under the host-matrix shape the cone test reads. */
const SCRATCH_WORLD: MatrixElements = { elements: dagScratch.world };

export function createDagOraclePredicates(context: PredicateContext) {
  const { packed, records, nodeFlags, planes, views, stretches, focal, near } = context;
  const { perspective, viewPoint } = context;
  const { worlds } = packed;
  const coneRejects = (index: number, w: number) => {
    if (!hasBoxOf(records, index)) return false;
    const { cone, min, max } = dagScratch;
    coneInto(records, index, cone);
    boxInto(records, index, min, max);
    // Kernel world matrices are those of the render frame, whose uniforms `cameraWorld` is the
    // origin: a perspective camera is at zero there. The oracle therefore reads the view point
    // of that frame — putting the world position here would mix an absolute operand with
    // relative boxes, and the cone would decide wrongly.
    copyMatrix4(dagScratch.world, worlds, 0, w * 16);
    return coneCullsPage(cone, SCRATCH_WORLD, min, max, viewPoint);
  };
  const visible = (index: number) => {
    // The owner node lives in the cold, outside what each frame pass rereads.
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
      perspective,
    );
  };
  const selects = (index: number, threshold: number) =>
    bandPixels(index, 0) <= threshold && bandPixels(index, 1) > threshold;
  return { coneRejects, visible, bandPixels, selects };
}
