/** A conservative cell-loading sphere enclosing every camera sphere, including off-axis corners. */
export function unionViewReach(views: readonly { eye: ArrayLike<number>; reach: number }[]) {
  if (!views.length) throw new Error('VIEW_REACH_EMPTY');
  const eye = Array.from(views[0].eye),
    first = views[0].reach;
  let reach = first;
  for (let i = 1; i < views.length; i++) {
    const next = views[i];
    if (!Number.isFinite(reach) || !Number.isFinite(next.reach)) {
      reach = Infinity;
      continue;
    }
    const dx = next.eye[0] - eye[0],
      dy = next.eye[1] - eye[1],
      dz = next.eye[2] - eye[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance + next.reach <= reach) continue;
    if (distance + reach <= next.reach) {
      eye.splice(0, 3, ...Array.from(next.eye));
      reach = next.reach;
      continue;
    }
    const radius = (reach + distance + next.reach) / 2;
    const shift = (radius - reach) / distance;
    eye[0] += dx * shift;
    eye[1] += dy * shift;
    eye[2] += dz * shift;
    reach = radius;
  }
  return { eye, reach };
}
