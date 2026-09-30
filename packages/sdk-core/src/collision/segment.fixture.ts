/** Whether `p` lies on segment `s` (`[ax, ay, az, bx, by, bz]`): its parameter within `eps` of
 *  `[0, 1]`, its squared distance to the segment's line at most `gapEps`. */
export function onSegment(p: ArrayLike<number>, s: readonly number[], eps = 1e-9, gapEps = eps) {
  const d = [0, 1, 2].map((k) => s[3 + k] - s[k]);
  const len = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
  const t = len ? [0, 1, 2].reduce((sum, k) => sum + (p[k] - s[k]) * d[k], 0) / len : 0;
  const gap = [0, 1, 2].reduce((sum, k) => sum + (p[k] - s[k] - t * d[k]) ** 2, 0);
  return t >= -eps && t <= 1 + eps && gap <= gapEps;
}
