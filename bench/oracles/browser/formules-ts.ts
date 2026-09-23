// Oracles of the "shared TS formulas" batch: the code from before the factorisation, copied
// as-is from `develop` at commit 2dcc8fc. These copies are wanted duplicates — it is against
// them that the shared functions are opposed, value by value, by `Object.is`.

/** A vertex whose only two screen coordinates matter, as `visibilityProjection.ts` reads it. */
interface ScreenPoint {
  x: number;
  y: number;
}

/** `gpuDagOracleMath.ts:33-51` from before: reject by the six planes, ternary per component. */
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

/** `visibilityMath.ts:50-58` from before: signed area and affine barycentrics inline. */
export function referenceBarycentric(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  x: number,
  y: number,
) {
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (area === 0) return null;
  const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area,
    w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area,
    w2 = 1 - w0 - w1;
  if (w0 < 0 || w1 < 0 || w2 < 0) return null;
  return { w0, w1, w2, area };
}

/** Signed area as `visibilityRaster.ts`, `hizDepth.ts` and `pageRaster.ts` wrote it. */
export function referenceSignedArea(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

/** The three affine weights as `hizDepth.ts:48-50` and `pageRaster.ts:180-182` wrote them. */
export function referenceWeights(
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  x: number,
  y: number,
  area: number,
) {
  const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area;
  const w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area;
  const w2 = 1 - w0 - w1;
  return { w0, w1, w2 };
}

/** `webgpuPageRow.ts:98` and `webgpuRowCommit.ts:35` from before: the identifier base of a row. */
export function referencePackedRowBase(row: number, bits: number) {
  return ((row + 1) << bits) >>> 0;
}

/** `explorerCapabilities.ts:132-137` and `explorerViewportApi.ts:65-66` from before. */
export function referenceDevicePixels(
  logical: number,
  pixelRatio: number | undefined,
  defaut: number,
) {
  return Math.floor(logical * (pixelRatio ?? defaut));
}

/** `gpuTimingSample.ts` and `webglFrameTimer.ts` from before: nanoseconds to milliseconds. */
export function referenceNsToMs(nanoseconds: number) {
  return nanoseconds / 1e6;
}

/** `bench/runner/lampes.ts:11` and `poses.ts:56` from before: the model floor. */
export function referenceFloorOf(bounds: { min: { y: number }; max: { y: number } }) {
  return bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y;
}
