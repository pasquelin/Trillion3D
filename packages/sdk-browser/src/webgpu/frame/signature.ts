import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Number of values in the frame signature; see `sampleWebgpuFrame`. */
export const HOLD_SIGNATURE_VALUES = 23;

/**
 * Everything a frame produced that can be observed, in twenty-three numbers.
 *
 * Two consecutive frames whose three revisions and these twenty-three numbers match have done
 * exactly the same work: same rows, same occluder/tested partition, same draw calls, same
 * triangles, same occlusion verdicts, same shadows. That covers states that converge without
 * being written — the occluder history the tested half of the frame feeds, verdicts reread
 * with a delay — without having to keep a list of them.
 */
export function sampleWebgpuFrame(rt: WebgpuPagesRuntime, into: Float64Array) {
  const { run, timing, lights } = rt,
    { rows } = rt.layout,
    counts = timing.partitionCounts,
    hiz = rt.vis.gpuPartition?.counts();
  into[0] = rows.tableEpoch;
  into[1] = rows.rowsEpoch;
  into[2] = rows.packedCount;
  into[3] = rows.rowCount;
  into[4] = run.cutEpoch;
  into[5] = run.pageArrayEpoch;
  into[6] = run.visible;
  into[7] = run.selectedTriangles;
  into[8] = run.submittedTriangles;
  into[9] = run.drawnTriangles;
  into[10] = run.uncoveredTriangles;
  into[11] = run.frustumRejected;
  into[12] = run.lodLevel;
  into[13] = run.gpuDrawCalls;
  into[14] = run.blendDrawCalls;
  into[15] = run.blendSubmittedTriangles;
  into[16] = run.blendFrustumRejected;
  into[17] = counts.occulteurs;
  into[18] = counts.testees;
  into[19] = counts.historiqueOcculteurs;
  into[20] = lights.shadowsUpdated;
  into[21] = lights.shadowFaces;
  into[22] = hiz ? hiz.rejected : -1;
}
