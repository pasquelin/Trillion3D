import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Number of values in the frame signature; see `sampleWebgpuFrame`. */
export const HOLD_SIGNATURE_VALUES = 22;

/**
 * Everything a frame produced that can be observed, in twenty-two numbers.
 *
 * Two consecutive frames whose three revisions and these twenty-two numbers match have done
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
  into[10] = run.frustumRejected;
  into[11] = run.lodLevel;
  into[12] = run.gpuDrawCalls;
  into[13] = run.blendDrawCalls;
  into[14] = run.blendSubmittedTriangles;
  into[15] = run.blendFrustumRejected;
  into[16] = counts.occulteurs;
  into[17] = counts.testees;
  into[18] = counts.historiqueOcculteurs;
  into[19] = lights.shadowsUpdated;
  into[20] = lights.shadowFaces;
  into[21] = hiz ? hiz.rejected : -1;
}
