// Oracles of the "shared TS formulas" batch: the code from before the factorisation, copied
// as-is from `develop` at commit 2dcc8fc. These copies are wanted duplicates — it is against
// them that the shared functions are opposed, value by value, by `Object.is`.

/** A vertex whose only two screen coordinates matter, as `packages/sdk-browser/src/visibility/projection.ts` reads it. */
interface ScreenPoint {
  x: number;
  y: number;
}

/** The engine's earlier box reject: reject by the six planes, ternary per component. */
export function referenceOutsidePlanes(
  planes: ArrayLike<number>,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d < 0)
      return true;
  }
  return false;
}

/** Signed area as `packages/sdk-browser/src/visibility/raster.ts`, `packages/sdk-browser/src/hiz/depth.ts` and `packages/sdk-browser/src/page/raster.ts` wrote it. */
export function referenceSignedArea(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

/** `packages/sdk-browser/src/webgpu/row/pageRow.ts:98` and `packages/sdk-browser/src/webgpu/row/commit.ts:35` from before: the identifier base of a row. */
export function referencePackedRowBase(row: number, bits: number) {
  return ((row + 1) << bits) >>> 0;
}

/** `packages/sdk-browser/src/world/session/capabilities.ts:132-137` and `packages/sdk-browser/src/world/api/viewportApi.ts:65-66` from before. */
export function referenceDevicePixels(
  logical: number,
  pixelRatio: number | undefined,
  fallback: number,
) {
  return Math.floor(logical * (pixelRatio ?? fallback));
}

/** `packages/sdk-browser/src/gpu/timing/sample.ts` and `packages/sdk-browser/src/webgl/core/frameTimer.ts` from before: nanoseconds to milliseconds. */
export function referenceNsToMs(nanoseconds: number) {
  return nanoseconds / 1e6;
}

/** `bench/runner/lighting/lamps.ts:11` and `poses.ts:56` from before: the model floor. */
export function referenceFloorOf(bounds: { min: { y: number }; max: { y: number } }) {
  return bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y;
}
