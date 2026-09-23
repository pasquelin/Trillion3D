/**
 * What the Hi-Z occlusion test of a frame did, published as-is.
 *
 * These seven numbers live apart from `FrameMetrics` because they have their own RHYTHM: on the
 * GPU path they are accumulated by the device — the partition counts them while packing the rows, the
 * occlusion kernel while writing its verdicts — and the host only rereads them one frame in fifteen.
 */
export interface OcclusionFrameMetrics {
  /**
   * What the occlusion test did on a frame: the clusters handed to it, those it
   * eliminated, and those whose level-0 screen footprint exceeds the sixteen-texel kernel and
   * therefore answer from a coarser mip. `hiz*Triangles` are the triangles of those same
   * clusters.
   *
   * On the GPU path they describe a frame EARLIER than the one that renders them — `hizCountedFrame`
   * names which — like `gpuPassMs`, and two neighbouring frames often carry the same sample.
   * None is estimated: `null` on an engine that does not test occlusion, on a device whose
   * verdicts cannot be reread, and as long as no frame has been counted.
   */
  hizTestedClusters?: number | null;
  /** Clusters hidden. */
  hizRejectedClusters?: number | null;
  /** Clusters too big to test. */
  hizOversizedClusters?: number | null;
  /** Triangles tested. */
  hizTestedTriangles?: number | null;
  /** Triangles hidden. */
  hizRejectedTriangles?: number | null;
  /** Triangles too big to test. */
  hizOversizedTriangles?: number | null;
  /**
   * The frame the six counters above describe. It is the current frame where the oracle counts
   * on the CPU, and an earlier frame on the GPU path, whose counters are reread
   * periodically; without it, a reader cannot tell a count of this frame from a
   * count the last sampled frame left behind. `null` when there is none.
   */
  hizCountedFrame?: number | null;
}
