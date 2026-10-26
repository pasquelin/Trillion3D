import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { readRasterSetting } from '../../../../sdk-core/src/contracts/rasterOptions.ts'
import { voxelsPresent } from '../passes/slotWalk.ts'

/**
 * Whether the clusters of the cutout slots and of the software raster's cutout list are ordered by
 * depth bucket this image (the cut writes the bucket in the cluster's tag, `judgement.ts`): the
 * `depthBucketing` option — on, the reference's default — AND the scene holds voxel clusters. The
 * reference keeps the bucket in its visible-cluster records only where its project supports
 * assemblies or voxels, the larger record those features need: a scene of plain triangles is not
 * ordered, in the reference's configuration. The engine's only run-time sign of those features is
 * a voxel class among the resident clusters' (`PresentClasses`).
 */
export const depthBucketsOn = (rt: WebgpuPagesRuntime) =>
  readRasterSetting(rt, 'depthBucketing') && voxelsPresent(rt)
