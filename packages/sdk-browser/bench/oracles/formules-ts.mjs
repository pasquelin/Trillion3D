// Oracles du lot « formules communes TS » : le code d'avant la factorisation, recopié tel quel
// depuis `develop` au commit 2dcc8fc. Ces copies sont des doublons voulus — c'est contre elles que
// les fonctions communes sont opposées, valeur par valeur, par `Object.is`.

/** `gpuDagOracleMath.ts:33-51` d'avant : rejet par les six plans, ternaire par composante. */
export function referenceOutsidePlanes(planes, minX, minY, minZ, maxX, maxY, maxZ) {
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

/** `visibilityMath.ts:50-58` d'avant : aire signée et barycentriques affines en ligne. */
export function referenceBarycentric(a, b, c, x, y) {
  const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (area === 0) return null;
  const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area,
    w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area,
    w2 = 1 - w0 - w1;
  if (w0 < 0 || w1 < 0 || w2 < 0) return null;
  return { w0, w1, w2, area };
}

/** L'aire signée telle que `visibilityRaster.ts`, `hizDepth.ts` et `pageRaster.ts` l'écrivaient. */
export function referenceSignedArea(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

/** Les trois poids affines tels que `hizDepth.ts:48-50` et `pageRaster.ts:180-182` les écrivaient. */
export function referenceWeights(a, b, c, x, y, area) {
  const w0 = ((b.x - x) * (c.y - y) - (c.x - x) * (b.y - y)) / area;
  const w1 = ((c.x - x) * (a.y - y) - (a.x - x) * (c.y - y)) / area;
  const w2 = 1 - w0 - w1;
  return { w0, w1, w2 };
}

/** `webgpuPageRow.ts:98` et `webgpuRowCommit.ts:35` d'avant : le socle d'identifiant d'une ligne. */
export function referencePackedRowBase(row, bits) {
  return ((row + 1) << bits) >>> 0;
}

/** `gpuBounceProbes.ts:121` et `gpuBounceSurface.ts:117` d'avant : le lot borné par le budget. */
export function referenceBounceBatch(ceiling, load) {
  return Math.max(1, Math.round(ceiling * load));
}

/** `explorerCapabilities.ts:132-137` et `explorerViewportApi.ts:65-66` d'avant. */
export function referenceDevicePixels(logical, pixelRatio, defaut) {
  return Math.floor(logical * (pixelRatio ?? defaut));
}

/** `gpuTimingSample.ts` et `webglFrameTimer.ts` d'avant : nanosecondes vers millisecondes. */
export function referenceNsToMs(nanoseconds) {
  return nanoseconds / 1e6;
}

/** `scripts/mesure/lampes.mjs:11` et `poses.mjs:56` d'avant : le plancher du modèle. */
export function referenceFloorOf(bounds) {
  return bounds.min.y < 0 && bounds.max.y > 0 ? 0 : bounds.min.y;
}
