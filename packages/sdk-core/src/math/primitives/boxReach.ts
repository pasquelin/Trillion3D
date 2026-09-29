// How far a flat box (`box.ts`, least corner then most) reaches from a point or along an axis.
/** Distance from the point `(x, y, z)` to the box's farthest corner. */
export function boxPointFarthest(
  box: ArrayLike<number>,
  o: number,
  x: number,
  y: number,
  z: number,
) {
  const dx = Math.max(x - box[o], box[o + 3] - x),
    dy = Math.max(y - box[o + 1], box[o + 4] - y),
    dz = Math.max(z - box[o + 2], box[o + 5] - z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Least of `axis · (p − origin)` over the box: how far along `axis` its nearest corner lies. */
export function boxLeastAlong(
  box: ArrayLike<number>,
  o: number,
  axis: ArrayLike<number>,
  origin: ArrayLike<number>,
) {
  let least = 0;
  for (let k = 0; k < 3; k++)
    least += axis[k] * ((axis[k] > 0 ? box[o + k] : box[o + 3 + k]) - origin[k]);
  return least;
}
