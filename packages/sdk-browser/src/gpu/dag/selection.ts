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
import type { GpuSelection } from '../core/selection.ts';
import type { PackedDag } from './types.ts';
import { selectionRepeat, type DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts';
import { createDagResources } from './resources.ts';
import { createDagRuntime } from './runtime.ts';
import { createDagLightCut, type DagLightCut } from './lightCut.ts';
export { packDagSelection, packedWorldsToRenderOrigin } from './pack.ts';
export { DAG_SELECTION_SHADER } from './shader/shader.ts';
export { evaluateDagSelectionKernel } from './oracle/oracle.ts';
export type { PackedDag } from './types.ts';

const lightCuts = new WeakMap<
  GpuSelection,
  { resources: NonNullable<Awaited<ReturnType<typeof createDagResources>>>; cut?: DagLightCut }
>();

/**
 * The same cut seen from the lights (`lightCut.ts`), on the resources of `selection`: created at
 * the first call, kept for the life of the selection, whose dispose releases it.
 */
export function lightCutOf(selection: GpuSelection) {
  const entry = lightCuts.get(selection);
  if (!entry) return undefined;
  return (entry.cut ??= createDagLightCut(entry.resources));
}

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
  if (!resources) return undefined;
  const selection = createDagRuntime(resources);
  lightCuts.set(selection, { resources, cut: undefined });
  return selection;
}
