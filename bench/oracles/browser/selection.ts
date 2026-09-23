// Pure A6 and A7 oracles, no side effects: `selection.bench.ts` measures them; unit tests
// import them as reference.

/** `packages/sdk-browser/src/page/selection/math.ts:110-134` before batch A: one branch per plane and per vertex. */
export function referenceBoxClip(
  planes: Float64Array,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  let inside = 2;
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p],
      b = planes[p + 1],
      c = planes[p + 2],
      d = planes[p + 3];
    if (a * (a > 0 ? maxX : minX) + b * (b > 0 ? maxY : minY) + c * (c > 0 ? maxZ : minZ) + d < 0)
      return 0;
    if (
      inside === 2 &&
      a * (a > 0 ? minX : maxX) + b * (b > 0 ? minY : maxY) + c * (c > 0 ? minZ : maxZ) + d < 0
    )
      inside = 1;
  }
  return inside;
}

/** `packages/sdk-browser/src/page/selection/requests.ts:77-96` before batch A: a `Set` allocated per call without stamps. */
export function referenceCollectPendingUrls<
  T extends { array?: Uint32Array; url: string; streamUrl?: string },
>(shown: readonly T[], into: string[]) {
  into.length = 0;
  const seen = new Set();
  for (let i = 0; i < shown.length; i++) {
    const rec = shown[i];
    if (rec.array) continue;
    const key = rec.streamUrl ?? rec.url;
    if (seen.has(key)) continue;
    seen.add(key);
    into.push(key);
  }
  return into;
}

interface ResidencyOracleEnv {
  bootstrapUrls: Set<string>;
  modifiedPages: Set<string>;
  shown: { url: string; array?: Uint32Array }[];
  desired: { url: string; array?: Uint32Array }[];
  pending: string[];
  retained: string[];
}

/** `packages/sdk-browser/src/backend/autonomous/residency.ts:24-37` before batch A: `includes` in a loop, `Set` and three spreads. */
export function referenceResidency(env: ResidencyOracleEnv) {
  const { bootstrapUrls, modifiedPages, shown, desired, pending, retained } = env;
  return {
    pendingUrls() {
      pending.length = 0;
      for (const rec of desired)
        if (!rec.array && !pending.includes(rec.url)) pending.push(rec.url);
      return pending;
    },
    pageUrls() {
      retained.length = 0;
      const unique = new Set([...bootstrapUrls, ...modifiedPages]);
      for (const rec of shown) unique.add(rec.url);
      for (const rec of desired) unique.add(rec.url);
      retained.push(...unique);
      return retained;
    },
  };
}
