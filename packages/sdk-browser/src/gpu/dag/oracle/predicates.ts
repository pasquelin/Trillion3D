import { coneCullsPage } from '../../../page/cone/cone.ts';
import { SELECTION_NONE as NONE } from '../../core/selection.ts';
import type { PackedDag } from '../types.ts';
import { CLUSTER_NEVER } from '../layout.ts';
import {
  bandError,
  bandSphere,
  boxInto,
  coneInto,
  type DagRecords,
  flagsOf,
  hasBoxOf,
  ownerOf,
  worldOf,
} from '../records.ts';
import { copyMatrix4, frustumExcludesBox } from '../../../../../sdk-core/src/index.ts';
import {
  boxMissesLightPages,
  type LightPages,
} from '../../../../../sdk-core/src/scene/light-shadow/pageOverlap.ts';
import { dagScratch, projectedError } from './math.ts';
import { drawsCluster } from '../../../page/cut/rule.ts';
import type { MatrixElements } from '../../../math/matrixElements.ts';

/** The cut rule as the oracle applies it on page `page`: `drawsCluster`'s operands, then the page. */
export type CutRuleAt = (
  resident: boolean,
  parentPixels: number,
  ownPixels: number,
  childResident: boolean,
  threshold: number,
  page: number,
) => boolean;

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
  /** A light's cut: casters write both faces, no cone rejects them, and a box must reach one
   *  of the face's redrawn pages (`DagViewUniforms.light`). */
  light?: LightPages;
  /** The cut rule applied: `drawsCluster`, or the kernel's WGSL call site run in Node by the
   *  rule's tests, which reads the page's residency itself. */
  rule?: CutRuleAt;
};

/** The scratch world under the host-matrix shape the cone test reads. */
const SCRATCH_WORLD: MatrixElements = { elements: dagScratch.world };

export function createDagOraclePredicates(context: PredicateContext) {
  const { packed, records, nodeFlags, planes, views, stretches, focal, near } = context;
  const { perspective, viewPoint, light } = context;
  const { worlds } = packed;
  const coneRejects = (index: number, w: number) => {
    if (light || !hasBoxOf(records, index)) return false;
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
    const w = worldOf(records, index);
    if (frustumExcludesBox(planes[w], min[0], min[1], min[2], max[0], max[1], max[2])) return false;
    return !light || !boxMissesLightPages(light, min, max, views[w], perspective);
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
  /** The cut rule (`../../../page/cut/rule.ts`) on page `index`, under the residency given. */
  const rule = context.rule ?? drawsCluster;
  const draws = (index: number, threshold: number, ready: boolean, childReady: boolean) =>
    rule(ready, bandPixels(index, 1), bandPixels(index, 0), childReady, threshold, index);
  return { coneRejects, visible, bandPixels, draws };
}
