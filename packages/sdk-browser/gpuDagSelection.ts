/**
 * GPU cut of a cluster DAG (`errorModel: dag-group-qem-v1`).
 *
 * Every cluster carries its own screen-error band, so no cluster depends on another. One thread per
 * candidate cluster evaluates `parentErrorPx > pixelError >= lodErrorPx` with the same projection as
 * `clusterErrorPixels`; the candidates come from a level-by-level descent of the primitive's culling
 * hierarchy, one indirect pass per level, which rejects a whole subtree at once (out of frustum, or
 * a subtree whose largest replacement error already fits the budget) and never reads the clusters
 * below it. Rejection there is a pure accelerator: a node's box contains every cluster box below it
 * and its `maxParentError` bounds every `parentError` below it, so the selected set is identical
 * with or without the hierarchy.
 */
import type { GpuSelection } from './gpuSelection.ts';
import type { PackedDag } from './gpuDagTypes.ts';
import { selectionRepeat, type DiagnosticGpuVariant } from './diagnosticGpuVariant.ts';
import { createDagResources } from './gpuDagResources.ts';
import { createDagRuntime } from './gpuDagRuntime.ts';
export { packDagSelection, packedWorldsToRenderOrigin } from './gpuDagPack.ts';
export { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
export { evaluateDagSelectionKernel } from './gpuDagOracle.ts';
export type { PackedDag } from './gpuDagTypes.ts';

export async function createGpuDagSelection(
  device: GPUDevice,
  packed: PackedDag,
  options: { residentCut?: boolean; diagnosticGpuVariant?: DiagnosticGpuVariant } = {},
): Promise<GpuSelection | undefined> {
  if (typeof device.createComputePipeline !== 'function' || packed.pageCount < 1) return undefined;
  const resources = await createDagResources(
    device,
    packed,
    !!options.residentCut,
    selectionRepeat(options.diagnosticGpuVariant),
  );
  return resources ? createDagRuntime(resources) : undefined;
}
