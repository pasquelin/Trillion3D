// The uniform block of a cut: the camera state every GPU selection kernel reads (`./selection.ts`).

/**
 * `perspective` is the projection's clip-w weight (`EngineCamera.perspective`), 1 when absent.
 * `view` and `planes` are those of the render frame — the planes of the render matrix the image
 * draws with, its jitter included (`viewProj`) —, and `cameraWorld` — the eye's world position,
 * ancestors resolved — is its ORIGIN: the camera is at zero in the frame the kernel works in, and
 * this triplet only names that frame for a sample or an oracle. `pixelError` is the threshold the
 * cut reads: the host's pixels per edge, divided by the view's level-of-detail factor and the
 * streaming quality scale (`../../frame/render/gpuCut.ts`).
 */
export type SelectionUniforms = {
  planes: Float32Array
  view: Float32Array
  pixelScale: [number, number]
  pixelError: number
  near: number
  cameraWorld: [number, number, number]
  perspective?: number
  /** The render matrix the image draws with — its jitter included —, from the render frame to clip
   *  space, the projection's clip depth along its clip weight, `z = x · w + y`, and the view's size
   *  in pixels: what a box is projected with to the pixel centres it covers
   *  (`../../geometry/dag/shader/occlusionWgsl.ts`). */
  viewProj: Float32Array
  depthMap: [number, number]
  viewSize: [number, number]
  /** What the occlusion runs (`OCCLUSION_TWO_PASS`); none when absent. */
  occlusion?: number
  /** The culls the host turned off (`CULL_FRUSTUM_OFF`, `CULL_MIN_LOD_OFF`,
   *  `CULL_DRAW_DISTANCE_OFF`, `../../geometry/dag/shader/viewsWgsl.ts`); none when absent. */
  cullOff?: number
  /** The scale every placement's draw distance is multiplied by (`cutViewDistanceScale`,
   *  `../../geometry/dag/shader/drawDistanceWgsl.ts`); 1 when absent. */
  viewDistanceScale?: number
  /** The view's clip plane in the render frame, `dot(xyz, p) + w` at least 0 drawn
   *  (`../../geometry/dag/shader/clipPlaneWgsl.ts`); all zero for none. */
  clipPlane: [number, number, number, number]
  /** The bits of the view's filter, a bit a placement, set when the view does not draw it
   *  (`../../geometry/selection/viewFilter.ts`): the array's identity is the filter's revision;
   *  none when absent. */
  filter?: Uint32Array
  /** The previous image's render matrix composed at this image's eye, its depth map and its size:
   *  what the main pass tests the previous pyramid with. Read only under `OCCLUSION_TWO_PASS`. */
  prevViewProj?: Float32Array
  prevDepthMap?: [number, number]
  prevSize?: [number, number]
  /** The host's frame: the clock the rows' closure stamps a row's use with, and, for a cut whose
   *  occlusion runs two passes, its identity — such a cut reads the pyramid of the image before,
   *  and no two images cut on the same one (`../../geometry/dag/swap/swap.ts`). */
  frame?: number
}
