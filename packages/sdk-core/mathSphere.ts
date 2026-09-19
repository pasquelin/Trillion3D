/**
 * Bounding sphere of a box, written flat: centre `x, y, z` then radius, from `o`.
 *
 * The centre is the midpoint of the bounds, `(min + max) * 0.5`; the radius is half the diagonal,
 * `‖max − min‖ * 0.5`, the length being `Math.sqrt(x² + y² + z²)`. An empty box — an upper bound
 * below its lower bound — yields the empty sphere, zero centre and radius `-1`. This is the
 * Three.js box arithmetic term by term: the same bits, NaN, signed zeros and infinities included.
 */
export function sphereFromBounds(
  out: Float64Array,
  o: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) {
  if (maxX < minX || maxY < minY || maxZ < minZ) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    out[o + 3] = -1;
    return;
  }
  out[o] = (minX + maxX) * 0.5;
  out[o + 1] = (minY + maxY) * 0.5;
  out[o + 2] = (minZ + maxZ) * 0.5;
  const sx = maxX - minX,
    sy = maxY - minY,
    sz = maxZ - minZ;
  out[o + 3] = Math.sqrt(sx * sx + sy * sy + sz * sz) * 0.5;
}
