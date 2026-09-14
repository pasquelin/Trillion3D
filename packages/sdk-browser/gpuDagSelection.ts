/**
 * GPU cut of a cluster DAG (`errorModel: dag-group-qem-v1`).
 *
 * Every cluster carries its own screen-error band, so nothing walks a tree. One thread per cluster
 * evaluates `parentErrorPx > pixelError >= lodErrorPx` with the same projection as
 * `clusterErrorPixels`; one thread per culling node turns the primitive's flat hierarchy into an
 * early reject (out of frustum, or a subtree whose largest replacement error already fits the
 * budget). Rejection there is a pure accelerator: a node's box contains every cluster box below it
 * and its `maxParentError` bounds every `parentError` below it, so the selected set is identical
 * with or without the hierarchy.
 */
import type { GpuSelection } from './gpuSelection.ts';
import type { PackedDag } from './gpuDagTypes.ts';
import { createDagResources } from './gpuDagResources.ts';
import { createDagRuntime } from './gpuDagRuntime.ts';
export { packDagSelection } from './gpuDagPack.ts';
export { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
export { evaluateDagSelectionKernel } from './gpuDagOracle.ts';
export type { PackedDag } from './gpuDagTypes.ts';

export async function createGpuDagSelection(
  device: GPUDevice,
  packed: PackedDag,
  options: { residentCut?: boolean } = {},
): Promise<GpuSelection | undefined> {
  if (typeof device.createComputePipeline !== 'function' || packed.pageCount < 1) return undefined;
  const resources = await createDagResources(device, packed, !!options.residentCut);
  return resources ? createDagRuntime(resources) : undefined;
}
