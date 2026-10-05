/**
 * GPU DIAGNOSTIC variants. They exist only to split a duration: each one neutralises ONE
 * factor of the frame without touching the encoded commands — same passes, same draw calls,
 * same order, same sort — with three declared exceptions: the doubled cut re-encodes its
 * selection, `geometry-one-pass` drops the second visibility pass, and `raster-compute` and
 * `raster-hybrid` hand all or part of the opaque geometry to the compute raster; their
 * durations do not subtract like the others. The rendered image therefore DIFFERS from the
 * production image by construction: none is an optimisation, none is measured in fidelity,
 * and no production path turns one on. The only way is `diagnosticGpuVariant` of
 * `openMeasuredWorld`, refused outside `diagnosticDetail: 'trace'`.
 */
export const DIAGNOSTIC_GPU_VARIANTS = [
  /** Blend fragment stage renders a constant colour: no texture, no lighting. */
  'blend-flat',
  /** Fragment stage discards immediately: only vertices and rasterisation remain. */
  'blend-vertices',
  /** Full fragment stage, with no colour write at all (mask at zero). */
  'blend-no-colour',
  /** Constant fragments, with no write, counted by occlusion query: the overdraw rate. */
  'blend-overdraw',
  /** Composition no longer writes the swap-chain view: off-screen presentation. */
  'present-offscreen',
  /** The whole cut is encoded TWICE. Each kernel restarts from the reset, so the final
   *  state and the image are those of a single run: the frame gap is the true cost of
   *  selection, waits between dispatches included, that no pass envelope reports. */
  'selection-doubled',
  /** The head of the cut — prepare, nodes, wanted clusters — encoded twice, also
   *  idempotent. By subtraction with the previous, the tail: mask, compaction. */
  'selection-head-doubled',
  /** Visibility raster no longer applies the opacity mask: no atlas read, no discard. */
  'geometry-flat',
  /** Visibility raster discards immediately: only vertices and triangles remain. */
  'geometry-vertices',
  /** The second visibility pass is not encoded: occluders only. */
  'geometry-one-pass',
  /** The compute raster draws the WHOLE opaque and masked cut, as b72278c6 did in
   *  production; without it, the hardware raster draws. Two sides that differ only by it
   *  give, at the same size, the envelope and the frame gap of compute against hardware. */
  'raster-compute',
  /** The hybrid split: triangles of the raster's fine class — a box of three pixels
   *  of side at most — to the compute raster, all others to hardware. That is the production
   *  candidate; it only enters if the envelope says so. */
  'raster-hybrid',
  /** Surface resolve reads nothing and returns a constant value. */
  'resolve-flat',
  /** Surface resolve reads only the visibility buffer, with no material and no atlas. */
  'resolve-ids',
] as const;
