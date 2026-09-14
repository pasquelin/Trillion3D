import { coneCullsPage } from './pageCone.ts';
import {
  PAGE_CONE_FLOATS,
  SELECTION_NONE as NONE,
  type SelectionUniforms,
} from './gpuSelection.ts';
import { CLUSTER_FLOATS, CLUSTER_NEVER, type PackedDag } from './gpuDagTypes.ts';
import { dagScratch, outsidePlanes, projectedError } from './gpuDagOracleMath.ts';

type PredicateContext = {
  packed: PackedDag;
  uniforms: SelectionUniforms;
  clusterInts: Uint32Array;
  nodeFlags: Uint8Array;
  planes: Float64Array[];
  views: number[][];
  stretches: number[];
  focal: number;
  near: number;
};

export function createDagOraclePredicates(context: PredicateContext) {
  const { packed, uniforms, clusterInts, nodeFlags, planes, views, stretches, focal, near } =
    context;
  const { clusters, pageCones, worlds } = packed;
  const coneRejects = (index: number, w: number) => {
    const base = index * PAGE_CONE_FLOATS;
    if (!pageCones[base + 7]) return false;
    const { cone, cam, min, max } = dagScratch;
    cone.axis[0] = pageCones[base];
    cone.axis[1] = pageCones[base + 1];
    cone.axis[2] = pageCones[base + 2];
    cone.angle = pageCones[base + 3];
    min[0] = pageCones[base + 4];
    min[1] = pageCones[base + 5];
    min[2] = pageCones[base + 6];
    max[0] = pageCones[base + 8];
    max[1] = pageCones[base + 9];
    max[2] = pageCones[base + 10];
    const cw = uniforms.cameraWorld;
    cam.position.set(cw[0], cw[1], cw[2]);
    cam.updateMatrixWorld();
    dagScratch.world.fromArray(worlds.subarray(w * 16, w * 16 + 16));
    return coneCullsPage(cone, dagScratch.world, min, max, cam);
  };
  const visible = (index: number) => {
    const base = index * CLUSTER_FLOATS,
      w = clusterInts[base + 10],
      node = clusterInts[base + 12];
    if (clusterInts[base + 13] & CLUSTER_NEVER) return false;
    if (node !== NONE && nodeFlags[node]) return false;
    const cone = index * PAGE_CONE_FLOATS;
    return !outsidePlanes(
      planes[w],
      pageCones[cone + 4],
      pageCones[cone + 5],
      pageCones[cone + 6],
      pageCones[cone + 8],
      pageCones[cone + 9],
      pageCones[cone + 10],
    );
  };
  const bandPixels = (index: number, at: number) => {
    const base = index * CLUSTER_FLOATS,
      w = clusterInts[base + 10],
      offset = at === 0 ? 0 : 4;
    return projectedError(
      at === 0 ? clusters[base + 8] : clusters[base + 9],
      clusters[base + offset],
      clusters[base + offset + 1],
      clusters[base + offset + 2],
      clusters[base + offset + 3],
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
