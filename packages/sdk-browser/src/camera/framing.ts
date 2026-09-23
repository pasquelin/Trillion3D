/** Perspective framing from a bounding-sphere radius. `near` scales with the asset; there is no absolute centimetre floor. */
export function framingFromBounds(radius: number, aspect: number) {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Empty scene bounds');
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Invalid aspect');
  const near = radius / 10000,
    far = radius * 20,
    scale = (radius * 1.9) / Math.min(1, aspect),
    len = Math.hypot(0.85, 0.65, 1);
  return {
    near,
    far,
    offset: [(0.85 * scale) / len, (0.65 * scale) / len, (1 * scale) / len] as [
      number,
      number,
      number,
    ],
  };
}
