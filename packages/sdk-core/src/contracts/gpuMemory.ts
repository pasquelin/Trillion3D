/**
 * Memory footprint published by the engine for allocations on the graphics device.
 *
 * WebGPU does not expose VRAM usage directly: byte counts are computed by a registry tracking
 * creation and destruction of every texture and buffer on the device.
 * `null` represents unmeasured data, never zero.
 */
export interface GpuMemoryFrameMetrics {
  /** Active allocated bytes on device across all resources. */
  gpuAllocatedBytes?: number | null;
  /** Allocated bytes grouped by resource label. Unlabeled allocations are grouped as 'unlabeled'. */
  gpuAllocatedByLabel?: Record<string, number> | null;
  /** Count of textures with unrecognized formats. Expected value is 0. */
  gpuAllocationsUnknownFormat?: number | null;
  /** Resolution-dependent frame targets (color, depth, visibility, HDR, surface, Hi-Z, TAA history). */
  gpuFrameTargetBytes?: number | null;
  /** Geometry page pool metrics: target bytes, discrete slots, and allocated bytes. */
  geometryPoolBytes?: number | null;
  /** Geometry pool slots. */
  geometryPoolSlots?: number | null;
  /** Geometry pool bytes. */
  geometryPoolAllocatedBytes?: number | null;
  /** Reason for pool size clamping: `root-cover`, `scene`, `page-cap`, `device-limit`, `ceiling`. */
  geometryPoolClamp?: string | null;
  /** Pages required by current frame beyond pool slot capacity. */
  geometryPoolSaturated?: number | null;
  /** Reason for texture pool clamping: `minimum`, `device-limit`. */
  texturePoolClamp?: string | null;
}
