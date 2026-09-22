/**
 * The numbers a diagnostic view paints with, computed here and nowhere else: the seed of an
 * identifier, the hue it maps to, and the error ramp. Pure arithmetic, so a view can read it
 * without loading the boundary that builds host objects.
 */

/** Stable 32-bit hash of a cluster or mesh id, used as a colour seed.
 *  Neighbour of `clusterHash` (visibilityMath.ts), which walks code points rather than
 *  UTF-16 units: same ×31 polynomial, two walks, two results outside the basic plane. */
export function hashId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return h;
}

/** Golden-ratio hue of an id, so neighbouring ids get distant colours. */
export function clusterHue(id: string) {
  return (hashId(id) * 0.61803398875) % 1;
}

/** Error is measured in screen pixels; green is exact, yellow approaches the cut threshold, red exceeds it. */
export function screenErrorRatio(error: number, threshold: number) {
  if (!(error > 0)) return 0;
  if (!Number.isFinite(error) || !(threshold > 0)) return 1;
  return Math.max(0, Math.min(1, error / threshold));
}

export function screenErrorColor(error: number, threshold: number): [number, number, number] {
  const ratio = screenErrorRatio(error, threshold);
  return [ratio, 1 - ratio, 0.12];
}
