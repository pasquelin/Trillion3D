import { visLayerTop } from './webgpuVisibilityUniforms.ts';
import { taaRenderMatrix } from './taaFrame.ts';
import type { PartitionFrame } from './gpuPartitionUniform.ts';
import type { EngineCamera } from './cameraWorld.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const noLevels: Array<{ offset: number; width: number }> = [];
const noMatrix = new Float64Array(16);

/**
 * Partition input, filled every image in the SAME object: `encode` writes it into the uniform and
 * copies into its own arrays what the audit keeps, so nothing here needs to be new. The anchor is a
 * tuple held the same way, so the camera pose allocates nothing.
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
  hasRest: false,
  viewMoved: true,
};

/**
 * Occluder/tested partition of the image, encoded for the GPU.
 *
 * Nothing there walks resident rows on the CPU any more: neither projecting boxes into screen
 * rectangles, nor splitting the two halves, nor preparing the Hi-Z test bounds. The image has already
 * uploaded the corners the table had just changed — and those only, before `uploadDirtyRows` closed
 * that range (`uploadRowCorners`). All that remains here is writing one uniform and two compute
 * dispatches whose count depends only on the row count. Nothing is reread: what the partition decided
 * comes back through the periodic sample.
 *
 * The matrices come from the ENGINE camera, which image entry has already filled from the pose
 * contract (`cameraWorld.ts`): view and view-projection are posted there once for the whole image, in
 * double precision, and the partition adds no matrix calculation.
 *
 * `twoPass` is a property of the RESOURCES, not of the decision: as soon as the pyramid, the tested-
 * half pipeline, indirect compaction and the partition exist, the image encodes its two passes. The
 * GPU may have put nothing in the tested half — a first image, or a view where nothing drawn last
 * image is hidden — and the second pass then draws zero instances. The CPU therefore never has
 * to wait for a GPU verdict to know what to encode.
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
  frame.view = cam.view;
  // The render matrix, temporal-antialiasing jitter included: the pyramid the occlusion test reads
  // was rasterised with it, and its margins are to the ulp.
  frame.viewProj = taaRenderMatrix(rt, cam);
  // Projection anchor: the eye in the world. Corners enter the kernel only by their offset from it,
  // which keeps the error bound tight whatever the model size.
  anchor[0] = cam.eye[0];
  anchor[1] = cam.eye[1];
  anchor[2] = cam.eye[2];
  frame.near = cam.near;
  frame.rows = rows.packedCount;
  frame.width = gpu.targetSize[0];
  frame.height = gpu.targetSize[1];
  frame.levels = twoPass ? vis.gpuHiz!.levels() : noLevels;
  frame.layerTop = visLayerTop(vis);
  frame.hasRest = twoPass;
  frame.viewMoved = run.hizViewMoved;
  partition.encode(encoder, frame);
  run.noOccluderHistory = false;
  // What encoding the partition costs the CPU: one uniform and two dispatches, never a resident
  // row. Projection and the split have no CPU bound left at all.
  timing.lastPartitionMs = performance.now() - start;
  // The image's counts are those the GPU wrote, reread one image in fifteen. They therefore describe
  // a previous image, never this one, and stay at zero before the first sample.
  const sample = partition.counts();
  counts.occulteurs = sample ? sample.occluders : 0;
  counts.testees = sample ? sample.tested : 0;
  counts.historiqueOcculteurs = sample ? sample.historyOccluders : 0;
  counts.retiresParLaPyramide = sample ? sample.withdrawn : 0;
  counts.imageRelevee = sample ? sample.frame : -1;
  return { twoPass };
}
